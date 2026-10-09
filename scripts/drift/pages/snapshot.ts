/**
 * deno task snapshot <label> [provider...]
 *
 * Fetch each provider's public pricing page once and store the converted
 * text under snapshots/<provider>/<label>.txt (+ .meta.json with url,
 * time, sha256 and ETag). These saved pages are the eval's base pages.
 */
import { loadSources, PAGE_PROVIDERS } from "../pages.ts";
import { fetchPage } from "./fetch.ts";

const [label, ...wanted] = Deno.args;
if (!label) {
    console.error("usage: snapshot <label> [provider...]");
    Deno.exit(2);
}
for (const provider of wanted.length ? wanted : PAGE_PROVIDERS) {
    const sources = await loadSources(provider);
    for (const source of sources.sources) {
        const res = await fetchPage(source.url);
        if (!res.ok) {
            console.error(`${provider}: ${source.url} -> ${res.status} ${res.error}`);
            continue;
        }
        await Deno.mkdir(`snapshots/${provider}`, { recursive: true });
        await Deno.writeTextFile(`snapshots/${provider}/${label}.txt`, res.snapshot.text);
        await Deno.writeTextFile(
            `snapshots/${provider}/${label}.meta.json`,
            JSON.stringify({
                url: source.url,
                fetchedAt: res.snapshot.fetchedAt,
                sha256: res.snapshot.sha256,
                etag: res.etag ?? null,
                note: "Public page text, saved for the eval. Content belongs to the vendor.",
            }, null, 2) + "\n",
        );
        console.log(`${provider}: ${res.snapshot.text.length} chars sha256:${res.snapshot.sha256.slice(0, 12)}`);
    }
}
