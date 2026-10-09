/**
 * deno task pins:export <path-to-monid-checkout> [provider...]
 *
 * Copies the PINNED rate cards (usage.model + usage.credits) of a few
 * providers out of a real Monid compile (`deno task compiler:compile`
 * writes .output/catalog.json), so this repo can run without the Monid
 * workspace. In the Monid repo itself the suite reads ctx.docs directly
 * and this file is not needed.
 */
const [root, ...wanted] = Deno.args;
if (!root) {
    console.error("usage: pins:export <monid-checkout> [provider...]");
    Deno.exit(2);
}
const providers = wanted.length > 0 ? wanted : ["firecrawl", "exa", "apollo"];
const catalog = JSON.parse(
    await Deno.readTextFile(`${root}/.output/catalog.json`),
);
const head = new TextDecoder().decode(
    (await new Deno.Command("git", {
        args: ["-C", root, "rev-parse", "HEAD"],
        stdout: "piped",
    }).output()).stdout,
).trim();
for (const provider of providers) {
    const docs = Object.values(
        catalog.endpoints as Record<string, any>,
    )
        .filter((doc) => doc.provider === provider)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((doc) => ({
            id: doc.id,
            provider: doc.provider,
            usage: { model: doc.usage.model, credits: doc.usage.credits },
        }));
    const out = {
        source: "github.com/monid-ai/monid (MIT), compiled catalog",
        monidCommit: head,
        exportedAt: new Date().toISOString(),
        docs,
    };
    await Deno.writeTextFile(
        `pins/${provider}.json`,
        JSON.stringify(out, null, 2) + "\n",
    );
    console.log(`pins/${provider}.json: ${docs.length} docs @ ${head.slice(0, 7)}`);
}
