import { assert, assertEquals } from "@std/assert";
import { checkProvider, savedPages } from "./pages.ts";
import { compare, normalizeUnit, pinnedRate } from "./pages/compare.ts";
import { checkQuote } from "./pages/extract.ts";
import { htmlToText } from "./pages/text.ts";
import type { PinnedDoc, Row, Source } from "./pages/types.ts";

const row = (r: Partial<Row>): Row => ({
    line: "JSON format",
    plan: null,
    price: 4,
    price_max: null,
    currency: "credits",
    per: 1,
    unit: "page",
    billing: "per_unit",
    maps_to: "json_format",
    evidence_quote: "+4 credits / page",
    ...r,
});

Deno.test("htmlToText keeps a column header next to its price", () => {
    const text = htmlToText(
        "<html><body><table><tr><th>Tier</th><th>Fast</th></tr><tr><td>Base</td><td>$7</td></tr></table></body></html>",
    );
    assert(text.includes("| Tier | Fast |"));
    assert(text.includes("| Base | $7 |"));
});

Deno.test("quote guard: verbatim, anchored, price inside", () => {
    const page = "| JSON format (LLM extraction) | +4 credits / page | Use an LLM |\n| Map | 1 credit / call |";
    assertEquals(checkQuote(row({}), page), undefined);
    // invented wording
    assert(checkQuote(row({ evidence_quote: "+4 credits per page" }), page));
    // price not in the quote
    assert(checkQuote(row({ price: 5 }), page));
    // a short quote must share a line with its label
    assertEquals(
        checkQuote(row({ line: "Map", price: 1, evidence_quote: "1 credit" }), page),
        undefined,
    );
    assert(checkQuote(row({ line: "Search", price: 1, evidence_quote: "1 credit" }), page));
    // cells joined with | pass only from one row
    assertEquals(
        checkQuote(row({ evidence_quote: "JSON format (LLM extraction) | +4 credits / page" }), page),
        undefined,
    );
});

Deno.test("units normalize across vendor wording", () => {
    assertEquals(normalizeUnit("requests"), "call");
    assertEquals(normalizeUnit("1k requests"), "call");
    assertEquals(normalizeUnit("company"), "organization");
    assertEquals(normalizeUnit("PDF pages"), "pdf page");
    assertEquals(normalizeUnit("scanned URL"), "url");
});

const docs: PinnedDoc[] = [{
    id: "firecrawl#scrape",
    provider: "firecrawl",
    usage: {
        model: {
            kind: "COMPOSITE",
            components: {
                json: { kind: "PER_UNIT", unit: "PAGE", every: 1, consumes: { credit: "default", amount: 4 } },
                block: { kind: "PER_UNIT", unit: "RESULT", every: 10, consumes: { credit: "default", amount: 2 } },
            },
        },
    },
}];
const source: Source = {
    url: "https://example.test/pricing",
    currency: "credits",
    verifiedAt: "2026-10-10",
    lines: [{
        key: "json_format",
        describe: "JSON format",
        expect: { units: ["page"], per: 1, regime: "per_unit" },
        backs: [{ docId: "firecrawl#scrape", line: "json" }],
    }],
    excluded: [],
};
const snap = { url: source.url, fetchedAt: "t", sha256: "abc", text: "" };
const run = (rows: Row[]) =>
    compare("firecrawl", source, snap, { rows, rejected: [], model: "m", replayed: true }, docs)
        .map((f) => `${f.check} ${f.docId}`);

Deno.test("pinned rate honours block size (every)", () => {
    assertEquals(pinnedRate(docs[0], "block")?.rate, 0.2);
});

Deno.test("comparator: match, rate, unit, regime, coverage", () => {
    assertEquals(run([row({})]), []);
    assertEquals(run([row({ price: 5 })]), ["rate firecrawl#scrape"]);
    assertEquals(run([row({ unit: "1k characters" })]), ["unit firecrawl#scrape"]);
    // regime alarm needs the model AND the unit rule to agree
    assertEquals(run([row({ unit: "call", billing: "flat" })]), ["regime firecrawl#scrape"]);
    assertEquals(run([row({ price: null, billing: "variable" })]), ["regime firecrawl#scrape"]);
    assertEquals(run([]), ["coverage firecrawl#scrape"]);
    assertEquals(
        run([row({}), row({ line: "screenshot", maps_to: null, price: 2 })]),
        ["coverage firecrawl/*"],
    );
});

Deno.test("suite replays a recorded extraction with no network", async () => {
    Deno.env.set("DRIFT_PAGES_LLM", "replay");
    const pins = JSON.parse(await Deno.readTextFile("pins/firecrawl.json"));
    const page = await Deno.readTextFile("eval/pages/07-firecrawl-json-price.txt");
    const report = await checkProvider(
        "firecrawl",
        pins.docs,
        savedPages({ "https://docs.firecrawl.dev/billing": page }),
    );
    const got = [...new Set(report.findings.map((f) => `${f.check} ${f.docId}`))].sort();
    assertEquals(got, [
        "rate firecrawl#batch/scrape",
        "rate firecrawl#crawl",
        "rate firecrawl#scrape",
        "rate firecrawl#search",
    ]);
    assert(report.findings.every((f) => f.quote?.includes("+5 credits / page")));
});

Deno.test("an unreachable page is a source finding, not a rate alarm", async () => {
    const pins = JSON.parse(await Deno.readTextFile("pins/exa.json"));
    const report = await checkProvider("exa", pins.docs, savedPages({}));
    assertEquals(report.findings.map((f) => f.check), ["source"]);
});
