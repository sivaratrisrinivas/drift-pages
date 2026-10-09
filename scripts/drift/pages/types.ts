import { z } from "zod";

/** A per-provider pricing.sources.json: which public page backs which
 *  pinned usage.model lines. Seeded by hand from the URLs already cited in
 *  provider/endpoint comments. */
export const zRegime = z.enum(["flat", "per_unit", "variable", "free"]);
export type Regime = z.infer<typeof zRegime>;

export const zLine = z.object({
    key: z.string(),
    describe: z.string(),
    expect: z.object({
        units: z.array(z.string()).min(1),
        per: z.number().positive(),
        regime: zRegime,
    }),
    backs: z.array(z.object({
        docId: z.string(),
        line: z.string().optional(),
    })).min(1),
});
export type Line = z.infer<typeof zLine>;

export const zSource = z.object({
    url: z.string().url(),
    section: z.object({ from: z.string(), to: z.string().optional() })
        .optional(),
    currency: z.string(),
    verifiedAt: z.string(),
    citedIn: z.string().optional(),
    lines: z.array(zLine).min(1),
    excluded: z.array(z.object({
        key: z.string(),
        describe: z.string(),
        why: z.string(),
    })),
});
export type Source = z.infer<typeof zSource>;

export const zSources = z.object({
    provider: z.string(),
    sources: z.array(zSource).min(1),
});
export type Sources = z.infer<typeof zSources>;

/** One extracted rate row: the strict shape the model must return. */
export const zRow = z.object({
    line: z.string(),
    plan: z.string().nullable(),
    price: z.number().nullable(),
    price_max: z.number().nullable().optional(),
    currency: z.string().nullable(),
    per: z.number().positive(),
    unit: z.string().nullable(),
    billing: zRegime,
    maps_to: z.string().nullable(),
    evidence_quote: z.string().min(1),
});
export type Row = z.infer<typeof zRow>;

export const zRateTable = z.object({ rows: z.array(zRow) });

export interface Snapshot {
    url: string;
    fetchedAt: string;
    sha256: string;
    /** Full page text (HTML already converted). */
    text: string;
}

export interface Extraction {
    rows: Row[];
    /** Rows the model returned whose quote is not on the page (or whose
     *  price is not inside the quote). Dropped, counted, never alarmed on. */
    rejected: { row: Row; reason: string }[];
    model: string;
    replayed: boolean;
}

/** A finding plus the evidence a reviewer needs to re-pin by hand. */
export interface PageFinding {
    docId: string;
    check: "rate" | "unit" | "regime" | "coverage" | "source";
    message: string;
    line?: string;
    pinned?: number;
    live?: number;
    url: string;
    quote?: string;
    snapshot?: string;
}

/** The slice of Monid's compiled EndpointDoc this suite reads. */
export interface PinnedDoc {
    id: string;
    provider: string;
    usage: {
        model: UsageModel;
        credits?: Record<string, { label?: string }>;
    };
}

export type UsageModel =
    | { kind: "FREE" }
    | {
        kind: "PER_CALL";
        consumes: { credit: string; amount: number };
        label?: string;
    }
    | {
        kind: "PER_UNIT";
        unit: string;
        every?: number;
        consumes: { credit: string; amount: number };
        label?: string;
    }
    | {
        kind: "COMPOSITE";
        components: Record<string, UsageModel>;
    };

