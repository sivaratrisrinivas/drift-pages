import { complete } from "./llm.ts";
import { normalizeForQuote } from "./text.ts";
import {
    type Extraction,
    type Row,
    type Source,
    zRateTable,
    zRow,
} from "./types.ts";

/**
 * Page text -> strict rate table. The model does the two things rules do
 * badly on heterogeneous HTML: read a price grid, and say which known line a
 * row is (so a renamed tier at the same price is not an alarm). Everything
 * after that is deterministic: schema check, verbatim-quote check, and the
 * comparator.
 */
export const SYSTEM = `You read public API pricing pages and return a strict JSON rate table.
Return {"rows":[...]} and nothing else. Be exhaustive: one row for EVERY usage price on the page, every priced cell of every table (a price grid with 3 priced rows and 7 columns gives up to 21 rows) and every priced sentence. One row per usage price (a price charged for using the API: per call, per request, per page, per result, per record, per minute, and so on).
Do NOT return: subscription plan prices, credit pack or top-up prices, discounts, promotions, coupons, free-trial amounts, rate limits, or worked examples that add prices together.
Row fields:
- line: the line's name as the page writes it.
- plan: the tier or column the price belongs to (for example a column header), or null.
- price: the number as printed (for "$7 / 1k requests" price is 7; for "+4 credits / page" price is 4). For a range "2-7", price is the low end and price_max the high end. For a price with no number ("Dynamic", "usage-based", "Variable") price is null.
- price_max: high end of a range, else null.
- currency: "USD" for dollar prices, "credits" for credit prices.
- per: how many units the price covers (for "/ 10 results" per is 10; for "per 1k requests" per is 1000; otherwise 1). In a grid, a "(per 1k ...)" note in the row label or column header applies to every cell of that row or column.
- unit: the billed unit, singular, lower case, without the count (page, call, request, result, organization, person, url, pdf page, browser minute, credit, run). null only when the page names no unit.
- billing: "flat" when the price is per call or per request regardless of size, "per_unit" when it scales with a counted unit (pages, results, records, urls), "variable" when the page gives no fixed price, "free" when it costs 0.
- maps_to: the key of the KNOWN LINE or EXCLUDED LINE this row is, judged by meaning, not exact wording (a renamed tier with the same role is the same line). null only if the row matches none of them.
- evidence_quote: a span copied EXACTLY from the page text that contains the price, ideally the line name plus the price ("JSON format (LLM extraction) | +4 credits / page"). In a price grid where the price cell is short, the cell text alone ("$7") is fine. Copy characters exactly; do not paraphrase, reorder, or fix typos.
If a cell gives a range and also a breakdown ("1-9 credits: 1 credit for X; +8 credits if Y"), return the breakdown parts as separate rows.`;

export function buildUser(source: Source, text: string): string {
    const known = source.lines.map((l) => `- ${l.key}: ${l.describe}`)
        .join("\n");
    const excluded = source.excluded.map((l) => `- ${l.key}: ${l.describe}`)
        .join("\n");
    return `PAGE: ${source.url}
KNOWN LINES (map rows to these keys):
${known}
EXCLUDED LINES (also map rows to these keys when they match):
${excluded}

PAGE TEXT (tables are rows of | cells |):
<<<
${text}
>>>`;
}

/** The hallucination guard: the quote must be on the page, and the price
 *  must be printed inside the quote. */
export function checkQuote(row: Row, pageText: string): string | undefined {
    const page = normalizeForQuote(pageText);
    const quote = normalizeForQuote(row.evidence_quote);
    if (quote.length < 2) return "quote too short";
    if (!page.includes(quote)) {
        // A quote that joins a table row's cells with "|" passes only if
        // every fragment is verbatim AND all fragments sit on one page line.
        const parts = row.evidence_quote.split("|").map(normalizeForQuote)
            .filter((p) => p !== "");
        const oneLine = parts.length > 1 &&
            pageText.split("\n").some((l) => {
                const n = normalizeForQuote(l);
                return parts.every((p) => n.includes(p));
            });
        if (!oneLine) return "quote not found verbatim on page";
    }
    // A short quote ("$7") proves little on its own: it must share one page
    // line (one table row) with the row's own label.
    if (quote.length < 12) {
        const label = normalizeForQuote(row.line).slice(0, 40);
        const anchored = pageText.split("\n").some((l) => {
            const n = normalizeForQuote(l);
            return n.includes(quote) && n.includes(label);
        });
        if (!anchored) return "short quote not on the same page line as its label";
    }
    if (row.price !== null) {
        const digits = quote.replace(/,/g, "");
        const p = String(row.price);
        const re = new RegExp(`(^|[^0-9.])${p.replace(".", "\\.")}([^0-9]|$)`);
        const alt = p.startsWith("0.") ? p.slice(1) : undefined;
        if (!re.test(digits) && !(alt && digits.includes(alt))) {
            return `price ${p} not printed inside the quote`;
        }
    }
    return undefined;
}

export async function extract(
    source: Source,
    text: string,
): Promise<Extraction> {
    const call = { system: SYSTEM, user: buildUser(source, text) };
    const answer = await complete(call);
    let parsed: unknown;
    try {
        parsed = JSON.parse(answer.text);
    } catch {
        throw new Error(`model returned non-JSON (${answer.model})`);
    }
    // schema-check row by row so one malformed row cannot sink the table
    const rawRows = (parsed as any)?.rows;
    if (!Array.isArray(rawRows)) {
        zRateTable.parse(parsed); // throws a precise error
    }
    const rows: Row[] = [];
    const rejected: Extraction["rejected"] = [];
    const keys = new Set([
        ...source.lines.map((l) => l.key),
        ...source.excluded.map((l) => l.key),
    ]);
    for (const raw of rawRows as unknown[]) {
        const ok = zRow.safeParse(raw);
        if (!ok.success) {
            rejected.push({
                row: raw as Row,
                reason: `schema: ${ok.error.issues[0]?.message}`,
            });
            continue;
        }
        const row = ok.data;
        if (row.maps_to !== null && !keys.has(row.maps_to)) {
            row.maps_to = null; // an invented key is treated as unknown
        }
        const bad = checkQuote(row, text);
        if (bad) rejected.push({ row, reason: bad });
        else rows.push(row);
    }
    return { rows, rejected, model: answer.model, replayed: answer.replayed };
}
