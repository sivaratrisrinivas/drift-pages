/**
 * deno task eval
 * Runs every case in eval/cases.json through the real suite (extractor +
 * comparator) against its saved page, and scores it pass/fail: the set of
 * (check, docId) findings must equal the expected set exactly. Also counts
 * hallucinated quotes: a finding whose quote is not verbatim on the page.
 *
 * LLM calls replay from fixtures/llm when recorded (no network, no key);
 * DRIFT_PAGES_LLM=record re-asks the model.
 */
import type { PinnedDoc } from "../scripts/drift/pages/types.ts";
import { checkProvider, loadSources, savedPages } from "../scripts/drift/pages.ts";
import { checkQuote } from "../scripts/drift/pages/extract.ts";

const { cases } = JSON.parse(await Deno.readTextFile("eval/cases.json"));
const only = Deno.args[0];
const results: any[] = [];
let pass = 0, hallucinated = 0, rejectedTotal = 0, rowsTotal = 0;
const models = new Set<string>();

for (const c of cases) {
    if (only && !c.id.startsWith(only)) continue;
    const pins = JSON.parse(await Deno.readTextFile(`pins/${c.provider}.json`));
    const docs: PinnedDoc[] = pins.docs;
    const sources = await loadSources(c.provider);
    let page: string | null = null;
    try {
        page = await Deno.readTextFile(`eval/pages/${c.id}.txt`);
    } catch { /* unreachable case */ }
    const files: Record<string, string | null> = {};
    for (const s of sources.sources) files[s.url] = page;
    const t0 = performance.now();
    let report;
    try {
        report = await checkProvider(c.provider, docs, savedPages(files));
    } catch (e) {
        results.push({ ...c, pass: false, error: (e as Error).message });
        console.log(`${c.id.padEnd(34)} ERROR ${(e as Error).message}`);
        continue;
    }
    const got = [...new Set(report.findings.map((f) => `${f.check} ${f.docId}`))].sort();
    const want = [...new Set(c.expect.map((e: string[]) => `${e[0]} ${e[1]}`))].sort() as string[];
    const ok = got.length === want.length && got.every((g, i) => g === want[i]);
    let badQuotes = 0;
    for (const f of report.findings) {
        if (!f.quote || page === null) continue;
        const fake = { line: f.quote, price: null, evidence_quote: f.quote } as any;
        if (checkQuote(fake, page)) badQuotes++;
    }
    hallucinated += badQuotes;
    for (const s of report.sources) {
        if (s.extraction) {
            rejectedTotal += s.extraction.rejected.length;
            rowsTotal += s.extraction.rows.length + s.extraction.rejected.length;
            models.add(s.extraction.model);
        }
    }
    if (ok) pass++;
    results.push({
        id: c.id,
        provider: c.provider,
        kind: c.kind,
        expect: want,
        got,
        pass: ok,
        hallucinatedQuotes: badQuotes,
        ms: Math.round(performance.now() - t0),
        findings: report.findings,
        sources: report.sources,
    });
    console.log(`${c.id.padEnd(34)} ${ok ? "PASS" : "FAIL"}  want [${want.join(", ")}]  got [${got.join(", ")}]`);
}

const n = results.length;
const summary = {
    ranAt: new Date().toISOString(),
    cases: n,
    passed: pass,
    hallucinatedQuotesInFindings: hallucinated,
    modelRowsRejectedByQuoteGuard: rejectedTotal,
    modelRowsTotal: rowsTotal,
    models: [...models],
};
console.log(`\n${pass}/${n} passed, ${hallucinated} hallucinated quotes in findings, ${rejectedTotal}/${rowsTotal} model rows rejected by the quote guard (${[...models].join(", ")})`);
if (!only) {
    await Deno.writeTextFile(
        "eval/results.json",
        JSON.stringify({ summary, results }, null, 2) + "\n",
    );
    const md = [
        `| # | Case | Kind | Expected | Got | Result |`,
        `|---|---|---|---|---|---|`,
        ...results.map((r, i) =>
            `| ${i + 1} | ${r.id} | ${r.kind} | ${r.expect?.join("<br>") || "none"} | ${
                r.error ? `error: ${r.error}` : r.got.join("<br>") || "none"
            } | ${r.pass ? "pass" : "FAIL"} |`
        ),
        ``,
        `**${pass}/${n} passed.** Hallucinated quotes in findings: ${hallucinated}. Model rows dropped by the quote guard: ${rejectedTotal} of ${rowsTotal}. Model: ${[...models].join(", ")}.`,
    ].join("\n");
    await Deno.writeTextFile("eval/RESULTS.md", md + "\n");
}
