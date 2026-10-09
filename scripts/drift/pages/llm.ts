import { encodeHex } from "@std/encoding/hex";

/**
 * One JSON-mode chat call, record/replay like Monid's fixture convention:
 * every live response is saved under scripts/drift/pages/fixtures/<sha>.json, keyed by
 * model + prompt, so tests and the eval replay with no network and no key.
 *
 * DRIFT_PAGES_LLM = replay (fixtures only, fail on a miss)
 *                 | record (call the model, overwrite the fixture)
 *                 | auto   (default: replay on a hit, else call + record)
 *
 * Free tiers only: Gemini (GEMINI_API_KEY) first, Groq (GROQ_API_KEY) as a
 * fallback (DRIFT_PAGES_LLM_ORDER changes the order). Keys are read from the environment and never logged.
 */
export type LlmCall = { system: string; user: string };
export type LlmResult = { text: string; model: string; replayed: boolean };

const FIXTURES = Deno.env.get("DRIFT_PAGES_FIXTURES")
    ? new URL(`${Deno.env.get("DRIFT_PAGES_FIXTURES")}/`, `file://${Deno.cwd()}/`)
    : new URL("./fixtures/", import.meta.url);


async function sha(s: string): Promise<string> {
    return encodeHex(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    );
}

export async function fixtureKey(call: LlmCall): Promise<string> {
    // keyed on the prompt only, so a recorded answer replays no matter which
    // free provider produced it
    return (await sha(`${call.system}\n---\n${call.user}`)).slice(0, 24);
}

async function groq(call: LlmCall, model: string): Promise<string> {
    const key = Deno.env.get("GROQ_API_KEY");
    if (!key) throw new Error("GROQ_API_KEY not set");
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(180_000),
        headers: {
            "Authorization": `Bearer ${key}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model,
            temperature: 0,
            response_format: { type: "json_object" },
            max_completion_tokens: 4400,
            reasoning_effort: "low",
            messages: [
                { role: "system", content: call.system },
                { role: "user", content: call.user },
            ],
        }),
    });
    const body = await res.json();
    if (!res.ok) {
        const err = new Error(
            `groq ${res.status}: ${body?.error?.message ?? "error"}`,
        );
        (err as any).status = res.status;
        throw err;
    }
    return body.choices[0].message.content as string;
}

async function gemini(call: LlmCall, model: string): Promise<string> {
    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) throw new Error("GEMINI_API_KEY not set");
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
            method: "POST",
            signal: AbortSignal.timeout(180_000),
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": key,
            },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: call.system }] },
                contents: [{ role: "user", parts: [{ text: call.user }] }],
                generationConfig: {
                    temperature: 0,
                    responseMimeType: "application/json",
                },
            }),
        },
    );
    const body = await res.json();
    if (!res.ok) {
        const details: any[] = body?.error?.details ?? [];
        const quota = details.flatMap((d) => d.violations ?? [])
            .map((v: any) => v.quotaId).filter(Boolean).join(",");
        const retry = details.find((d) => d.retryDelay)?.retryDelay;
        const err = new Error(
            `gemini ${res.status}: ${
                String(body?.error?.message ?? "error").split("\n")[0]
            }${quota ? ` [${quota}]` : ""}${
                retry ? ` try again in ${parseFloat(retry)}s` : ""
            }`,
        );
        (err as any).status = res.status;
        throw err;
    }
    return body.candidates[0].content.parts.map((p: any) => p.text).join("");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Free-tier models in fallback order (provider:model). Gemini first: its
 *  free tier allows more tokens per minute than Groq's for a page-sized
 *  prompt. Override with DRIFT_PAGES_LLM_ORDER. */
const ORDER = (Deno.env.get("DRIFT_PAGES_LLM_ORDER") ??
    "gemini:gemini-3.5-flash,gemini:gemini-3.8-flash,groq:openai/gpt-oss-120b")
    .split(",").map((s) => s.trim());

async function live(call: LlmCall): Promise<{ text: string; model: string }> {
    const errors: string[] = [];
    for (const spec of ORDER) {
        const [provider, ...rest] = spec.split(":");
        const model = rest.join(":");
        const fn = provider === "groq" ? groq : gemini;
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                return { text: await fn(call, model), model: spec };
            } catch (e) {
                const status = (e as any).status;
                errors.push(`${spec}: ${(e as Error).message.slice(0, 400)}`);
                // free-tier rate limit or overload: wait, retry, then fall back
                const msg = (e as Error).message;
                // a daily free-tier quota will not recover by waiting
                if (/PerDay|tokens per day/i.test(msg)) break;
                if (status === 429 || status === 503) {
                    const hint = msg.match(/try again in ([0-9.]+)s/i);
                    await sleep(
                        hint ? (Number(hint[1]) + 2) * 1000 : 15_000 * (attempt + 1),
                    );
                    continue;
                }
                break;
            }
        }
    }
    throw new Error(`no free-tier model answered: ${errors.join("; ")}`);
}

export async function complete(call: LlmCall): Promise<LlmResult> {
    const mode = Deno.env.get("DRIFT_PAGES_LLM") ?? "auto";
    const key = await fixtureKey(call);
    const path = new URL(`${key}.json`, FIXTURES);
    if (mode !== "record") {
        try {
            const saved = JSON.parse(await Deno.readTextFile(path));
            return { text: saved.text, model: saved.model, replayed: true };
        } catch {
            if (mode === "replay") {
                throw new Error(
                    `no recorded LLM fixture ${key} (set DRIFT_PAGES_LLM=auto and a free-tier key to record)`,
                );
            }
        }
    }
    const answer = await live(call);
    await Deno.mkdir(FIXTURES, { recursive: true });
    await Deno.writeTextFile(
        path,
        JSON.stringify(
            {
                model: answer.model,
                recordedAt: new Date().toISOString(),
                text: answer.text,
            },
            null,
            2,
        ) + "\n",
    );
    return { ...answer, replayed: false };
}
