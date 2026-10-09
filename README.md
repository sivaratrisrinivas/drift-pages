# drift-pages

Pricing-page drift alarms for [Monid](https://github.com/monid-ai/monid) connectors. A prototype by Srinivas Sivaratri. Not affiliated with Monid.

**Demo:** https://drift-pages.onrender.com · **Video (86 s, silent, captioned):** [demo.mp4](https://drift-pages.onrender.com/demo.mp4) · **Eval:** [eval/RESULTS.md](eval/RESULTS.md)

**Problem.** Monid's drift guard (`deno task drift`, design D28) only runs where a vendor publishes machine-readable pricing. [`scripts/drift/contract.ts`](https://github.com/monid-ai/monid/blob/main/scripts/drift/contract.ts) says suites ship "ONLY when the vendor publishes a machine-readable surface", and today that is Apify. Other providers, like Firecrawl ([provider.ts](https://github.com/monid-ai/monid/blob/main/connectors/firecrawl/provider.ts): "Firecrawl exposes no machine-readable pricing surface, so there is no drift suite for it"), rely on `test:live` and the per-run mismatch signal, which fires on a real run. Many endpoint files already cite a public pricing URL next to the pinned rate.

**What it does.** For each provider it reads the public pricing page, has a free-tier model extract a strict rate table where every row carries a verbatim quote, drops any row whose quote is not on the page, and compares the rest to the pinned `usage.model` with plain code. Findings use Monid's `DriftFinding` shape (`rate`, `unit`, `regime`, `coverage`, `source`) and rate changes go to `.output/drift-repin.json`. It never edits a pin.

**Eval (run for real, 20 saved pages): 18/20 passed, 0 hallucinated quotes in findings**, 3 of 405 model rows dropped by the quote guard. No-change controls 6/6, price 4/4, unit 1/2, regime 2/2, new line 1/2, renamed tier, table-to-cards, unreachable page and promo banner all pass. The two misses:
- unit change on Exa Contents: the model did not link the changed row to its line, so it raised "line missing" plus "new line" instead of a `unit` alarm (alerted, but mislabeled);
- new Apollo "Phone number lookup" line: the model mapped it onto the excluded mobile-phone line, so it was silently skipped. This is the real risk: an excluded-line list can swallow new lines.

**Quickstart (under 5 minutes, no keys, no network for the model):**
```
git clone https://github.com/sivaratrisrinivas/drift-pages && cd drift-pages
deno task test                                              # 7 tests, replayed model calls
deno task drift:pages --provider firecrawl --pages demo/raised   # planted price rise -> 4 findings, exit 1
deno task eval                                              # all 20 cases from recorded answers
```
Drop it into Monid: `integration/apply.sh /path/to/monid` (copies `scripts/drift/pages*` and a 10-line patch; on monid@b3e7b0c `deno check` passes and `deno task drift --provider firecrawl` runs: [integration/monid-run.txt](integration/monid-run.txt)).

**Built vs simulated.**
- Real: Monid's contract and naming, pins exported from a real Monid compile (`pins/`, monid@b3e7b0c), the public pricing pages of Firecrawl, Exa and Apollo fetched 2026-10-10 (`snapshots/`), live model calls (recorded in `scripts/drift/pages/fixtures/` so CI replays them).
- Simulated: every price, unit and pricing-model change in the eval (planted by hand in saved copies, see `eval/cases.json`); the schedule (run by hand, no GitHub Action); the "page unreachable" case.
- Limits: 3 providers, one page each. Free-tier quotas meant the 20 cases were answered by four free models (Gemini 3.5 Flash, 3.8 Flash, 3.5 Flash Lite, Groq gpt-oss-120b; recorded per case), so the score is not one model's score. Nothing here describes Monid's internal systems; it reads only the public repo.

**Next steps.** Guard the excluded list (a row mapped to an excluded line must share its label words, else alarm); run the eval on one model; add the drift.yml secret for a model key; seed `pricing.sources.json` for more providers from the URLs already cited in endpoint comments.

Data credits: page text belongs to Firecrawl, Exa and Apollo and is saved only as eval input. Pinned rates from monid-ai/monid (MIT). Code MIT.
