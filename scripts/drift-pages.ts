/**
 * deno task drift:pages [--provider <name>] [--pages <dir>]
 *
 * Standalone twin of Monid's `deno task drift` for the page suites, reading
 * pins exported from a real Monid compile (pins/<provider>.json). Same
 * output shape, same exit code rule: exit 1 on any finding.
 *
 * --pages <dir> reads saved page text (<dir>/<provider>.txt) instead of the
 * live site, which is how the demo swaps in a mutated snapshot.
 */
import { Command } from "@cliffy/command";
import type { PinnedDoc } from "./drift/pages/types.ts";
import {
    livePages,
    loadSources,
    PAGE_PROVIDERS,
    pagesSuite,
    savedPages,
} from "./drift/pages.ts";

const { options } = await new Command()
    .name("drift:pages")
    .description("Check pinned rates against vendors' public pricing pages.")
    .option("--provider <name:string>", "Only this provider's suite.")
    .option("--pages <dir:string>", "Read saved page text from this dir.")
    .parse(Deno.args);

const wanted = options.provider !== undefined
    ? PAGE_PROVIDERS.filter((name) => name === options.provider)
    : PAGE_PROVIDERS;
if (wanted.length === 0) {
    console.error(
        `${options.provider}: no pricing.sources.json; known: ${PAGE_PROVIDERS.join(", ")}`,
    );
    Deno.exit(2);
}

let total = 0;
for (const provider of wanted) {
    const pins = JSON.parse(
        await Deno.readTextFile(`pins/${provider}.json`),
    );
    const docs: PinnedDoc[] = pins.docs;
    let read = livePages;
    if (options.pages) {
        const sources = await loadSources(provider);
        const files: Record<string, string | null> = {};
        for (const s of sources.sources) {
            try {
                files[s.url] = await Deno.readTextFile(
                    `${options.pages}/${provider}.txt`,
                );
            } catch {
                files[s.url] = null;
            }
        }
        read = savedPages(files);
    }
    console.log(
        `${provider}: checking ${docs.length} pinned docs (monid@${
            String(pins.monidCommit).slice(0, 7)
        }) against public pricing pages`,
    );
    const findings = await pagesSuite(provider, read).run({
        docs,
        fix: false,
        log: (line) => console.log(line),
        token: "",
    });
    if (findings.length > 0) {
        console.error(`\n${provider} drift (${findings.length}):`);
        for (const finding of findings) {
            console.error(
                `  ${finding.docId} [${finding.check}] ${finding.message}`,
            );
        }
    } else {
        console.log(`\n${provider}: all ${docs.length} docs match the published page`);
    }
    total += findings.length;
}
Deno.exit(total > 0 ? 1 : 0);
