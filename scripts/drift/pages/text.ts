import { parseHTML } from "linkedom";

// deno-lint-ignore no-explicit-any
type Element = any;

/**
 * HTML to plain text for pricing pages. Tables become pipe rows so a column
 * header stays next to its price ("| Fast / Auto Search | $7 |"), which is
 * what lets a small model read column-oriented price grids. Scripts, styles,
 * nav and footers are dropped. Deterministic: same HTML, same text.
 */
const SKIP = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "SVG",
    "TEMPLATE",
    "IFRAME",
    "NAV",
    "FOOTER",
    "HEAD",
]);
const BLOCK = new Set([
    "P",
    "DIV",
    "SECTION",
    "ARTICLE",
    "LI",
    "UL",
    "OL",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "BR",
    "HR",
    "MAIN",
    "HEADER",
    "ASIDE",
    "DT",
    "DD",
    "BLOCKQUOTE",
    "PRE",
    "SUMMARY",
    "DETAILS",
    "FIGURE",
]);

function inline(el: Element): string {
    const parts: string[] = [];
    walk(el, parts);
    return parts.join(" ").replace(/\s+/g, " ").trim();
}

function walk(node: Element, out: string[]): void {
    for (const child of Array.from(node.childNodes as ArrayLike<Element>)) {
        if (child.nodeType === 3) {
            out.push((child.textContent ?? "").replace(/\s+/g, " "));
            continue;
        }
        if (child.nodeType !== 1) continue;
        const el = child as unknown as Element;
        if (SKIP.has(el.tagName)) continue;
        if (el.getAttribute("aria-hidden") === "true") continue;
        if (el.tagName === "TABLE") {
            out.push("\n");
            for (const tr of Array.from(el.querySelectorAll("tr") as ArrayLike<Element>)) {
                const cells = Array.from((tr as Element).children as ArrayLike<Element>)
                    .filter((c) => c.tagName === "TD" || c.tagName === "TH")
                    .map((c) => inline(c as Element) || "-");
                if (cells.some((c) => c !== "-")) out.push(`| ${cells.join(" | ")} |\n`);
            }
            out.push("\n");
            continue;
        }
        const block = BLOCK.has(el.tagName);
        if (block) out.push("\n");
        walk(el, out);
        if (block) out.push("\n");
    }
}

export function htmlToText(html: string): string {
    const { document } = parseHTML(html) as unknown as { document: Element };
    const body = document?.body;
    if (!body) return "";
    const out: string[] = [];
    walk(body, out);
    return out.join("")
        .split("\n")
        .map((line) => line.replace(/[ \t\u00a0\u200b]+/g, " ").trim())
        .filter((line) => line !== "" && line !== "\u200b")
        .join("\n") + "\n";
}

/** Cut the priced section out of a page by two anchor lines. Falls back to
 *  the whole page when an anchor is missing, so a restructured page still
 *  gets read (and is never silently skipped). */
export function section(
    text: string,
    from?: string,
    to?: string,
): { text: string; cut: boolean } {
    if (!from) return { text, cut: false };
    const start = text.indexOf(from);
    if (start < 0) return { text, cut: false };
    const end = to ? text.indexOf(to, start + from.length) : -1;
    return {
        text: text.slice(start, end > start ? end : undefined),
        cut: true,
    };
}

/** The verbatim check's normal form: whitespace and table pipes collapse,
 *  nothing else changes (case, digits and punctuation must match). */
export function normalizeForQuote(s: string): string {
    return s.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
}
