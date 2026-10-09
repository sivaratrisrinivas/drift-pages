import type {
    PinnedDoc,
    UsageModel,
    Extraction,
    Line,
    PageFinding,
    Row,
    Snapshot,
    Source,
} from "./types.ts";

/**
 * Extracted page table vs the PINNED usage.model. Deterministic: no model
 * call happens here. Emits Monid-shaped findings (check = rate | unit |
 * regime | coverage | source) and never edits a pin (D28 fix policy).
 */

const UNIT_SYNONYMS: Record<string, string> = {
    call: "call",
    request: "call",
    search: "call",
    query: "call",
    "api call": "call",
    "api request": "call",
    organization: "organization",
    organisation: "organization",
    company: "organization",
    org: "organization",
    person: "person",
    people: "person",
    contact: "person",
    profile: "person",
    url: "url",
    "scanned url": "url",
    page: "page",
    "web page": "page",
    "scraped page": "page",
    "pdf page": "pdf page",
    result: "result",
    "search result": "result",
    "browser minute": "minute",
    minute: "minute",
    credit: "credit",
    run: "run",
    task: "run",
};

export function normalizeUnit(unit: string | null): string {
    let u = (unit ?? "").toLowerCase().trim()
        .replace(/^(per|\/)\s*/, "")
        .replace(/^[0-9.,]+\s*k?\s+/, "")
        .replace(/[.]$/, "");
    if (UNIT_SYNONYMS[u]) return UNIT_SYNONYMS[u];
    if (u.endsWith("ies")) u = u.slice(0, -3) + "y";
    else if (u.endsWith("s")) u = u.slice(0, -1);
    return UNIT_SYNONYMS[u] ?? u;
}

function normalizeCurrency(c: string | null): string {
    const x = (c ?? "").toLowerCase().trim();
    if (x === "$" || x === "usd" || x === "us dollars" || x === "dollars") {
        return "usd";
    }
    if (x.startsWith("credit")) return "credits";
    return x;
}

/** The pinned per-unit rate of one doc line (amount / every). */
export function pinnedRate(
    doc: PinnedDoc,
    line?: string,
): { rate: number; kind: string } | undefined {
    let model: UsageModel = doc.usage.model;
    if (model.kind === "COMPOSITE") {
        if (!line || !model.components[line]) return undefined;
        model = model.components[line];
    }
    if (model.kind === "FREE") return { rate: 0, kind: "FREE" };
    if (model.kind === "PER_CALL") {
        return { rate: model.consumes.amount, kind: "PER_CALL" };
    }
    if (model.kind === "PER_UNIT") {
        return {
            rate: model.consumes.amount / (model.every ?? 1),
            kind: "PER_UNIT",
        };
    }
    return undefined;
}

const fmt = (n: number) => Number(n.toPrecision(6)).toString();
const same = (a: number, b: number) =>
    Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

function describeRow(r: Row): string {
    const price = r.price === null
        ? "no fixed price"
        : `${fmt(r.price)}${r.price_max ? `-${fmt(r.price_max)}` : ""} ${r.currency ?? ""}`;
    return `${price} per ${r.per === 1 ? "" : `${fmt(r.per)} `}${r.unit ?? "?"}`;
}

export function compare(
    provider: string,
    source: Source,
    snapshot: Snapshot,
    extraction: Extraction,
    docs: PinnedDoc[],
): PageFinding[] {
    const findings: PageFinding[] = [];
    const byId = new Map(docs.map((d) => [d.id, d]));
    const ref = { url: source.url, snapshot: snapshot.sha256.slice(0, 12) };
    const pageCurrency = normalizeCurrency(source.currency);

    for (const line of source.lines) {
        const rows = extraction.rows.filter((r) => r.maps_to === line.key);
        if (rows.length === 0) {
            for (const back of line.backs) {
                findings.push({
                    ...ref,
                    docId: back.docId,
                    check: "coverage",
                    line: back.line ?? line.key,
                    message:
                        `pinned line "${line.key}" is no longer published on ${source.url} (or could not be read); confirm by hand before re-pinning`,
                });
            }
            continue;
        }
        findings.push(...checkLine(line, rows, byId, ref, pageCurrency));
    }

    // D29 completeness: a published usage price that is neither modeled nor
    // in the documented EXCLUDED list
    for (const row of extraction.rows.filter((r) => r.maps_to === null)) {
        if (regimeOf(row) === "free") continue;
        findings.push({
            ...ref,
            docId: `${provider}/*`,
            check: "coverage",
            message:
                `new billable line on the page, not modeled and not excluded: "${row.line}"${
                    row.plan ? ` (${row.plan})` : ""
                } at ${describeRow(row)}`,
            quote: row.evidence_quote,
        });
    }
    return findings;
}

/** The row's billing regime, two ways: the model's word, and a rule from
 *  the unit (a price per call or request is flat, anything counted is
 *  per-unit). "variable" and "free" come from the price itself. */
export function ruleRegime(r: Row): Row["billing"] {
    if (r.price === null || r.billing === "variable") return "variable";
    if (r.price === 0 || r.billing === "free") return "free";
    return normalizeUnit(r.unit) === "call" ? "flat" : "per_unit";
}

/** A regime alarm needs the model AND the rule to agree the regime moved:
 *  vendor wording like "$1 per 1k requests" for a per-result surcharge
 *  fools the rule, and the model sometimes blurs flat vs per-unit. */
export function regimeMoved(r: Row, expected: Row["billing"]): boolean {
    return ruleRegime(r) !== expected && r.billing !== expected;
}

/** Kept for the coverage pass: free lines are not billable news. */
export const regimeOf = ruleRegime;

function checkLine(
    line: Line,
    rows: Row[],
    byId: Map<string, PinnedDoc>,
    ref: { url: string; snapshot: string },
    pageCurrency: string,
): PageFinding[] {
    const out: PageFinding[] = [];
    const expectUnits = new Set(line.expect.units.map(normalizeUnit));

    // regime: one disagreeing row is enough (alarm-biased by design)
    const regimeRow = rows.find((r) => regimeMoved(r, line.expect.regime));
    if (regimeRow) {
        for (const back of line.backs) {
            out.push({
                ...ref,
                docId: back.docId,
                check: "regime",
                line: back.line ?? line.key,
                message:
                    `"${line.key}" was ${line.expect.regime}, page now reads ${
                        ruleRegime(regimeRow)
                    } (${
                        describeRow(regimeRow)
                    })`,
                quote: regimeRow.evidence_quote,
            });
        }
        return out;
    }
    if (line.expect.regime === "variable" || line.expect.regime === "free") {
        return out;
    }

    const unitRow = rows.find((r) => !expectUnits.has(normalizeUnit(r.unit)));
    if (unitRow) {
        for (const back of line.backs) {
            out.push({
                ...ref,
                docId: back.docId,
                check: "unit",
                line: back.line ?? line.key,
                message: `"${line.key}" was billed per ${
                    line.expect.units[0]
                }, page now bills per ${unitRow.unit} (${describeRow(unitRow)})`,
                quote: unitRow.evidence_quote,
            });
        }
        return out;
    }

    for (const back of line.backs) {
        const doc = byId.get(back.docId);
        const pin = doc ? pinnedRate(doc, back.line) : undefined;
        if (!pin) {
            out.push({
                ...ref,
                docId: back.docId,
                check: "coverage",
                line: back.line,
                message:
                    `sources file names ${back.docId}${
                        back.line ? `.${back.line}` : ""
                    } but no such pinned line exists (stale sources file)`,
            });
            continue;
        }
        for (const row of rows) {
            if (row.price === null) continue;
            if (normalizeCurrency(row.currency) !== pageCurrency) {
                out.push({
                    ...ref,
                    docId: back.docId,
                    check: "rate",
                    line: back.line ?? line.key,
                    message:
                        `"${line.key}" is now priced in ${row.currency}, pinned pool is ${pageCurrency}`,
                    quote: row.evidence_quote,
                });
                break;
            }
            const live = row.price / row.per;
            if (!same(live, pin.rate)) {
                out.push({
                    ...ref,
                    docId: back.docId,
                    check: "rate",
                    line: back.line ?? line.key,
                    pinned: pin.rate,
                    live,
                    message: `${back.line ?? line.key}: pinned ${
                        fmt(pin.rate)
                    } per ${line.expect.units[0]}, page says ${
                        fmt(live)
                    } (${describeRow(row)})`,
                    quote: row.evidence_quote,
                });
                break;
            }
        }
    }
    return out;
}
