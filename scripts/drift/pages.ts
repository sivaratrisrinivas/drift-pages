/**
 * drift-pages: DriftSuites for providers whose pricing lives only on a
 * public HTML page (design D28 extension). Same contract, same policy as
 * scripts/drift/apify.ts: alarm-only, a machine-readable re-pin report,
 * pinned amounts are never rewritten.
 *
 *   page (public HTML) -> text snapshot (sha256, ETag cache)
 *     -> model extracts a strict rate table, each row with a verbatim quote
 *     -> quote guard drops any row whose quote is not on the page
 *     -> deterministic comparator vs the compiled docs' usage.model
 *     -> DriftFinding[] + .output/drift-repin.json
 */
import type { DriftCtx, DriftFinding, DriftSuite } from "./contract.ts";
import { compare } from "./pages/compare.ts";
import { extract } from "./pages/extract.ts";
import { fetchPage, sha256 } from "./pages/fetch.ts";
import { section } from "./pages/text.ts";
import {
    type Extraction,
    type PageFinding,
    type PinnedDoc,
    type Snapshot,
    type Sources,
    zSources,
} from "./pages/types.ts";

export const PAGE_PROVIDERS = ["firecrawl", "exa", "apollo"];

export async function loadSources(provider: string): Promise<Sources> {
    const url = new URL(`./pages/sources/${provider}.json`, import.meta.url);
    return zSources.parse(JSON.parse(await Deno.readTextFile(url)));
}

/** Where page text comes from. Live by default; the eval and the demo
 *  pass saved pages instead (a missing page = "source unavailable"). */
export type PageReader = (url: string) => Promise<
    { ok: true; snapshot: Snapshot } | { ok: false; error: string }
>;

export const livePages: PageReader = async (url) => {
    const res = await fetchPage(url);
    return res.ok
        ? { ok: true, snapshot: res.snapshot }
        : { ok: false, error: `HTTP ${res.status} ${res.error}`.trim() };
};

export function savedPages(files: Record<string, string | null>): PageReader {
    return async (url) => {
        const text = files[url];
        if (text === undefined || text === null) {
            return { ok: false, error: "fetch failed (saved page missing)" };
        }
        return {
            ok: true,
            snapshot: {
                url,
                fetchedAt: "saved",
                sha256: await sha256(text),
                text,
            },
        };
    };
}

export interface ProviderReport {
    provider: string;
    findings: PageFinding[];
    sources: {
        url: string;
        snapshot?: string;
        extraction?: Extraction;
        error?: string;
    }[];
}

export async function checkProvider(
    provider: string,
    docs: PinnedDoc[],
    read: PageReader,
    log: (line: string) => void = () => {},
): Promise<ProviderReport> {
    const sources = await loadSources(provider);
    const report: ProviderReport = { provider, findings: [], sources: [] };
    for (const source of sources.sources) {
        const page = await read(source.url);
        if (!page.ok) {
            // an unreachable page is NOT a repricing: say so, check nothing
            report.findings.push({
                docId: `${provider}/*`,
                check: "source",
                url: source.url,
                message:
                    `source unavailable (${page.error}); rates on this page were not checked`,
            });
            report.sources.push({ url: source.url, error: page.error });
            continue;
        }
        const cut = section(
            page.snapshot.text,
            source.section?.from,
            source.section?.to,
        );
        if (source.section && !cut.cut) {
            log(`  ${source.url}: section anchor moved, reading the whole page`);
        }
        const extraction = await extract(source, cut.text);
        log(
            `  ${source.url}: ${extraction.rows.length} rows, ${extraction.rejected.length} rejected by the quote guard (${extraction.model}${
                extraction.replayed ? ", replayed" : ""
            })`,
        );
        report.findings.push(
            ...compare(provider, source, page.snapshot, extraction, docs),
        );
        report.sources.push({
            url: source.url,
            snapshot: page.snapshot.sha256,
            extraction,
        });
    }
    return report;
}

/** Merge this provider's rate re-pins into .output/drift-repin.json without
 *  clobbering other suites' entries (apify writes the same file). */
export async function writeRepins(
    report: ProviderReport,
    path = ".output/drift-repin.json",
): Promise<number> {
    let existing: any[] = [];
    try {
        existing = JSON.parse(await Deno.readTextFile(path));
    } catch { /* first writer */ }
    const mine = report.findings
        .filter((f) => f.check === "rate" && f.pinned !== undefined)
        .map((f) => ({
            docId: f.docId,
            line: f.line,
            pinned: f.pinned,
            live: f.live,
            source: { url: f.url, quote: f.quote, snapshot: f.snapshot },
        }));
    const kept = existing.filter((r) =>
        !String(r.docId).startsWith(`${report.provider}#`)
    );
    await Deno.mkdir(".output", { recursive: true });
    await Deno.writeTextFile(
        path,
        JSON.stringify([...kept, ...mine], null, 2) + "\n",
    );
    return mine.length;
}

export function pagesSuite(
    provider: string,
    read: PageReader = livePages,
): DriftSuite {
    return {
        provider,
        keyless: true,
        async run(ctx: DriftCtx): Promise<DriftFinding[]> {
            // Monid's EndpointDoc is a superset of the slice read here
            const docs = ctx.docs as unknown as PinnedDoc[];
            const report = await checkProvider(provider, docs, read, ctx.log);
            await Deno.mkdir(".output/drift-pages", { recursive: true });
            await Deno.writeTextFile(
                `.output/drift-pages/${provider}.json`,
                JSON.stringify(report, null, 2) + "\n",
            );
            const repins = await writeRepins(report);
            if (repins > 0) {
                ctx.log(
                    `  ${repins} rate re-pin(s) written to .output/drift-repin.json (pins NOT edited)`,
                );
            }
            return report.findings.map((f) => ({
                docId: f.docId,
                check: f.check,
                message: f.quote
                    ? `${f.message}\n      evidence: "${f.quote}" (${f.url})`
                    : `${f.message} (${f.url})`,
            }));
        },
    };
}

export const pageSuites: DriftSuite[] = PAGE_PROVIDERS.map((p) => pagesSuite(p));
