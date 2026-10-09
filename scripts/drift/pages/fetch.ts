import { encodeHex } from "@std/encoding/hex";
import { htmlToText } from "./text.ts";
import type { Snapshot } from "./types.ts";

/**
 * Fetch a public pricing page politely: one GET, a clear user agent,
 * ETag / If-None-Match against the stored snapshot, and a sha256 of the
 * converted text so an unchanged page never costs a model call.
 */
const UA = "drift-pages/0.1 (+https://github.com/sivaratrisrinivas/drift-pages)";

export async function sha256(s: string): Promise<string> {
    return encodeHex(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    );
}

export async function snapshotFromHtml(
    url: string,
    html: string,
    fetchedAt = new Date().toISOString(),
): Promise<Snapshot> {
    const text = htmlToText(html);
    return { url, fetchedAt, sha256: await sha256(text), text };
}

export type FetchResult =
    | { ok: true; snapshot: Snapshot; notModified: boolean; etag?: string }
    | { ok: false; status: number | "network"; error: string };

export async function fetchPage(
    url: string,
    previous?: { etag?: string; snapshot?: Snapshot },
): Promise<FetchResult> {
    try {
        const headers: Record<string, string> = { "User-Agent": UA };
        if (previous?.etag && previous.snapshot) {
            headers["If-None-Match"] = previous.etag;
        }
        const res = await fetch(url, {
            headers,
            redirect: "follow",
            signal: AbortSignal.timeout(20_000),
        });
        if (res.status === 304 && previous?.snapshot) {
            await res.body?.cancel();
            return {
                ok: true,
                snapshot: previous.snapshot,
                notModified: true,
                etag: previous.etag,
            };
        }
        if (!res.ok) {
            await res.body?.cancel();
            return { ok: false, status: res.status, error: res.statusText };
        }
        const html = await res.text();
        return {
            ok: true,
            snapshot: await snapshotFromHtml(url, html),
            notModified: false,
            etag: res.headers.get("etag") ?? undefined,
        };
    } catch (e) {
        return { ok: false, status: "network", error: (e as Error).message };
    }
}
