/**
 * deno task eval:build
 * Writes eval/pages/<case>.txt from the real base snapshot plus the case's
 * planted edits. Every find string must match exactly once, so a planted
 * change can never silently miss.
 */
const BASE = "2026-10-10a";
const { cases } = JSON.parse(await Deno.readTextFile("eval/cases.json"));

function once(text: string, find: string, id: string): number {
    const at = text.indexOf(find);
    if (at < 0 || text.indexOf(find, at + 1) >= 0) {
        throw new Error(`${id}: "${find}" must match exactly once`);
    }
    return at;
}

/** Table rows -> card blocks ("Name\nCost: ...\nNotes: ..."), headers dropped. */
function cards(text: string, from: string, to: string): string {
    const start = text.indexOf(from), end = text.indexOf(`\n${to}\n`, start) + 1;
    const mid = text.slice(start, end).split("\n");
    let header: string[] = [];
    const out: string[] = [];
    for (const line of mid) {
        if (!line.startsWith("| ")) {
            header = [];
            out.push(line);
            continue;
        }
        const cells = line.slice(2, -2).split(" | ");
        if (header.length === 0) {
            header = cells;
            continue;
        }
        out.push(cells[0]);
        cells.slice(1).forEach((c, i) => out.push(`${header[i + 1]}: ${c}`));
    }
    return text.slice(0, start) + out.join("\n") + text.slice(end);
}

for (const c of cases) {
    let text: string | null = await Deno.readTextFile(
        `snapshots/${c.provider}/${BASE}.txt`,
    );
    for (const op of c.ops) {
        if (op.unreachable) text = null;
        else if (op.replace) {
            const at = once(text!, op.replace[0], c.id);
            text = text!.slice(0, at) + op.replace[1] +
                text!.slice(at + op.replace[0].length);
        } else if (op.insertAfter) {
            const at = once(text!, op.insertAfter[0], c.id) +
                op.insertAfter[0].length;
            text = text!.slice(0, at) + "\n" + op.insertAfter[1] +
                text!.slice(at);
        } else if (op.swapLines) {
            const lines = text!.split("\n");
            const a = lines.findIndex((l) => l.startsWith(op.swapLines[0]));
            const b = lines.findIndex((l) => l.startsWith(op.swapLines[1]));
            if (a < 0 || b < 0) throw new Error(`${c.id}: swap target missing`);
            [lines[a], lines[b]] = [lines[b], lines[a]];
            text = lines.join("\n");
        } else if (op.cards) text = cards(text!, op.cards[0], op.cards[1]);
    }
    const path = `eval/pages/${c.id}.txt`;
    if (text === null) {
        await Deno.remove(path).catch(() => {});
        console.log(`${c.id}: (no page: unreachable)`);
    } else {
        await Deno.writeTextFile(path, text);
        console.log(`${c.id}: ${text.length} chars`);
    }
}
