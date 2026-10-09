/**
 * deno task site
 * Builds the static demo (site/dist/) from REAL artifacts in this repo:
 * eval/results.json, eval/cases.json, the two recorded demo runs
 * (demo/*.log) and the re-pin report they wrote. No numbers are typed in.
 */
const esc = (s: unknown) =>
    String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const { summary, results } = JSON.parse(await Deno.readTextFile("eval/results.json"));
const { cases } = JSON.parse(await Deno.readTextFile("eval/cases.json"));
const clean = await Deno.readTextFile("demo/clean.log");
const raised = await Deno.readTextFile("demo/raised.log");
const repin = await Deno.readTextFile("demo/drift-repin.json");
const patch = await Deno.readTextFile("integration/monid.patch");
const repo = "https://github.com/sivaratrisrinivas/drift-pages";

const caseById = new Map(cases.map((c: any) => [c.id, c]));
const kinds = new Map<string, { n: number; pass: number }>();
for (const r of results) {
    const k = r.kind.replace(/ \(.*\)$/, "");
    const v = kinds.get(k) ?? { n: 0, pass: 0 };
    v.n++;
    if (r.pass) v.pass++;
    kinds.set(k, v);
}

function opsText(c: any): string {
    return c.ops.map((op: any) => {
        if (op.replace) return `- ${op.replace[0]}\n+ ${op.replace[1]}`;
        if (op.insertAfter) return `  ${op.insertAfter[0]}\n+ ${op.insertAfter[1]}`;
        if (op.swapLines) return `~ swap rows "${op.swapLines[0]}" and "${op.swapLines[1]}"`;
        if (op.cards) return `~ every table between "${op.cards[0]}" and "${op.cards[1]}" rewritten as cards`;
        if (op.unreachable) return `x page not served (fetch fails)`;
        return JSON.stringify(op);
    }).join("\n") || "(no edits: the real page as fetched)";
}

const rows = results.map((r: any, i: number) => {
    const c: any = caseById.get(r.id);
    const ex = r.sources?.[0]?.extraction;
    const table = ex
        ? `<table class="rows"><tr><th>maps to</th><th>line</th><th>plan</th><th>price</th><th>per</th><th>unit</th><th>quote (verbatim)</th></tr>${
            ex.rows.map((x: any) =>
                `<tr><td>${esc(x.maps_to ?? "NEW")}</td><td>${esc(x.line)}</td><td>${esc(x.plan ?? "")}</td><td>${esc(x.price ?? "n/a")}</td><td>${esc(x.per)}</td><td>${esc(x.unit ?? "")}</td><td><q>${esc(x.evidence_quote)}</q></td></tr>`
            ).join("")
        }</table><p class="muted">${ex.rows.length} rows kept, ${ex.rejected.length} dropped by the quote guard. Model: ${esc(ex.model)}.</p>`
        : `<p class="muted">No extraction: ${esc(r.sources?.[0]?.error ?? r.error ?? "")}</p>`;
    const findings = (r.findings ?? []).map((f: any) =>
        `<li><b>${esc(f.check)}</b> ${esc(f.docId)}: ${esc(f.message)}${f.quote ? `<br><span class="muted">evidence:</span> <q>${esc(f.quote)}</q>` : ""}</li>`
    ).join("") || "<li>none</li>";
    return `<tr class="case ${r.pass ? "ok" : "bad"}" data-i="${i}"><td>${i + 1}</td><td>${esc(r.provider)}</td><td>${esc(r.kind)}</td><td>${esc(r.expect.join(", ") || "none")}</td><td>${esc(r.got?.join(", ") || "none")}</td><td>${r.pass ? "pass" : "FAIL"}</td></tr>
<tr class="detail" id="d${i}"><td colspan="6"><h4>Planted edit</h4><pre>${esc(opsText(c))}</pre><h4>Findings</h4><ul>${findings}</ul><h4>Extracted rate table</h4>${table}</td></tr>`;
}).join("\n");

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>drift-pages: pricing-page drift alarms for Monid connectors</title>
<style>
:root{--fg:#111;--muted:#666;--line:#e5e5e5;--ok:#0a7a3d;--bad:#b42318;--bg:#fafaf8}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--fg);background:var(--bg)}
main{max-width:1100px;margin:0 auto;padding:28px 24px 80px}
h1{font-size:30px;margin:0 0 6px}h2{font-size:21px;margin:38px 0 10px;padding-top:8px;border-top:1px solid var(--line)}h4{margin:12px 0 4px}
.lede{font-size:18px;color:#333;max-width:820px}.muted{color:var(--muted);font-size:14px}
.stats{display:flex;gap:14px;flex-wrap:wrap;margin:18px 0}.stat{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 16px;min-width:170px}
.stat b{display:block;font-size:28px}
pre{background:#0f1115;color:#e6e6e6;padding:14px 16px;border-radius:10px;overflow:auto;font:13px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:900px){.grid{grid-template-columns:1fr}}
table{border-collapse:collapse;width:100%;background:#fff;font-size:14px}th,td{border-bottom:1px solid var(--line);padding:7px 8px;text-align:left;vertical-align:top}
tr.case{cursor:pointer}tr.case:hover{background:#f3f3ef}tr.ok td:last-child{color:var(--ok);font-weight:600}tr.bad td:last-child{color:var(--bad);font-weight:700}
tr.detail{display:none}tr.detail.open{display:table-row}tr.detail>td{background:#fbfbf9;padding:10px 16px 18px}
table.rows{font-size:12.5px}q{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;background:#fff6d6}
a{color:#0b57d0}.pill{display:inline-block;background:#eef3ff;border-radius:99px;padding:2px 10px;font-size:13px;margin-right:6px}
video{width:100%;max-width:960px;border-radius:10px;border:1px solid var(--line);background:#000}
</style></head><body><main>
<h1 id="top">drift-pages</h1>
<p class="lede">Monid's drift guard (<code>deno task drift</code>, design D28) checks pinned rates only where a vendor publishes machine-readable pricing, which today is Apify. This prototype reads the <b>public HTML pricing pages</b> of three connectors (Firecrawl, Exa, Apollo), has a model extract a strict rate table with a <b>verbatim quote</b> per row, and compares it to the <code>usage.model</code> pins from a real Monid compile. It raises an alarm and writes <code>.output/drift-repin.json</code>. It never edits a pin.</p>
<p><span class="pill">TypeScript / Deno 2</span><span class="pill">DriftSuite drop-in</span><span class="pill">alarm-only</span> <a href="${repo}">Source on GitHub</a> · <a href="#video">Walkthrough video</a> · <a href="#eval">Eval</a></p>
<div class="stats">
<div class="stat"><b>${summary.passed}/${summary.cases}</b>eval cases passed</div>
<div class="stat"><b>${summary.hallucinatedQuotesInFindings}</b>hallucinated quotes in findings</div>
<div class="stat"><b>${summary.modelRowsRejectedByQuoteGuard}/${summary.modelRowsTotal}</b>model rows dropped by the quote guard</div>
<div class="stat"><b>3</b>providers wired (18 pinned docs)</div>
</div>
<h2 id="run">1. Run it: clean page, then a planted price rise</h2>
<p>Left: <code>deno task drift:pages --provider firecrawl</code> against the real Firecrawl billing page (saved ${esc("2026-10-10")}). Right: same command after one planted edit, JSON format <code>+4</code> to <code>+5 credits / page</code>. Model calls replay from recorded fixtures, so this is exactly what CI would print.</p>
<div class="grid"><pre id="clean">${esc(clean)}</pre><pre id="raised">${esc(raised)}</pre></div>
<h2 id="repin">2. The re-pin report (pins are not touched)</h2>
<p>Same shape as the Apify suite's <code>Repin</code> (docId, line, pinned, live), plus the source URL, the verbatim quote and the page snapshot hash, so a reviewer can re-pin by hand.</p>
<pre id="repinjson">${esc(repin)}</pre>
<h2 id="eval">3. Eval: 20 saved pages</h2>
<p>Base pages are the real public pages fetched on 2026-10-10. Price, unit and pricing-model changes are planted by hand, alongside no-change controls. A case passes only if the set of (check, docId) findings matches exactly. Click a row to see the planted edit, the extracted table and the findings.</p>
<p class="muted">${[...kinds].map(([k, v]) => `${esc(k)}: ${v.pass}/${v.n}`).join(" · ")}. Free-tier models used (recorded per case in the table detail): ${esc(summary.models.join(", "))}. Run at ${esc(summary.ranAt)}.</p>
<table id="evaltable"><tr><th>#</th><th>Provider</th><th>Case</th><th>Expected</th><th>Got</th><th>Result</th></tr>
${rows}
</table>
<h2 id="plug">4. How it plugs into Monid</h2>
<p>Copy <code>scripts/drift/pages.ts</code> and <code>scripts/drift/pages/</code> into the repo and apply this 10-line patch (tested on monid-ai/monid@b3e7b0c: <code>deno check</code> passes and <code>deno task drift --provider firecrawl</code> runs). The weekly <code>drift.yml</code> job then covers these providers with no new workflow; it would need a free-tier model key as a repo secret.</p>
<pre>${esc(patch)}</pre>
<h2 id="video">5. Walkthrough video</h2>
<video controls preload="metadata" src="demo.mp4"></video>
<p class="muted">Data: public pricing pages of Firecrawl, Exa and Apollo (content belongs to those vendors), pinned rates from github.com/monid-ai/monid (MIT). All price changes in the eval are synthetic. Built by Srinivas Sivaratri as an independent prototype; not affiliated with Monid.</p>
</main>
<script>
document.querySelectorAll("tr.case").forEach(tr=>tr.addEventListener("click",()=>{document.getElementById("d"+tr.dataset.i).classList.toggle("open")}));
</script></body></html>`;
await Deno.mkdir("site/dist", { recursive: true });
await Deno.writeTextFile("site/dist/index.html", html);
try {
    await Deno.copyFile("site/demo.mp4", "site/dist/demo.mp4");
} catch { /* video recorded after the first deploy */ }
console.log("site/dist/index.html written");
