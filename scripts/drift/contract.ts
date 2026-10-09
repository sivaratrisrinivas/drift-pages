/**
 * Types-only twin of monid-ai/monid scripts/drift/contract.ts at b3e7b0c
 * (MIT, Copyright (c) 2026 Monid Inc), so this repo runs standalone. In the
 * Monid repo, pages.ts imports the original file; the only proposed change
 * there is the optional `keyless` flag below (see integration/).
 */
import type { PinnedDoc as EndpointDoc } from "./pages/types.ts";

export interface DriftFinding {
    docId: string;
    /** Which check fired (e.g. "rate", "join", "schema", "regime"). */
    check: string;
    message: string;
}

export interface DriftCtx {
    /** The provider's compiled docs (from the .output/ compile cache). */
    docs: EndpointDoc[];
    /** FIX POLICY (design D28): hand-pinned assertions (rates) stay
     *  alarm-only with a machine-readable re-pin report. */
    fix: boolean;
    log: (line: string) => void;
    /** The suite's key, already resolved by the runner. For page suites
     *  this is unused: pages are public and need no vendor key. */
    token: string;
}

export interface DriftSuite {
    provider: string;
    /** Added by drift-pages (the one contract change it proposes): a suite
     *  that reads only public pages needs no vendor key, so the runner
     *  skips the key lookup instead of exiting 2. */
    keyless?: boolean;
    run(ctx: DriftCtx): Promise<DriftFinding[]>;
}
