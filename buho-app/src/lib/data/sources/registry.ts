import type { ParsedThread } from '$lib/types/messages';
import type { ArchiveContext, ImportEntry, RoutingResult, SourceParser } from './types';
import { PEEK_LENGTH } from './types';
import { metaJsonParser } from './metaJson';
import { normalizedJsonParser } from './normalizedJson';
import { whatsappTextParser } from './whatsappText';

/**
 * Every source Buho can read. Adding a service is one module plus one line
 * here — the importer, the derivation and the storage layer don't move.
 */
export const SOURCE_PARSERS: SourceParser[] = [
    metaJsonParser,
    normalizedJsonParser,
    whatsappTextParser,
];

/** Only these are ever opened; everything else is an attachment. */
const READABLE = /\.(json|txt)$/i;

export function buildArchiveContext(entries: ImportEntry[]): ArchiveContext {
    const paths = entries.map((e) => e.path.toLowerCase());
    return {
        paths,
        hasPathSegment: (segment: string) => {
            const needle = segment.toLowerCase();
            return paths.some((p) => p.includes(needle));
        },
    };
}

/**
 * Score every readable entry against every parser and group them by the winner.
 *
 * Routing is per **entry**, not per import: one dropped folder can legitimately
 * hold a Messenger archive next to a WhatsApp chat export, and forcing a single
 * verdict on the whole drop would silently discard one of them.
 */
export async function routeEntries(entries: ImportEntry[]): Promise<RoutingResult> {
    const ctx = buildArchiveContext(entries);
    const matched = new Map<SourceParser, ImportEntry[]>();
    const unmatched: ImportEntry[] = [];

    for (const entry of entries) {
        if (!READABLE.test(entry.name)) continue;

        let peek = '';
        try {
            peek = (await entry.text()).slice(0, PEEK_LENGTH);
        } catch {
            continue; // unreadable entry: not something to report as unrecognised
        }

        let winner: SourceParser | null = null;
        let bestScore = 0;
        for (const parser of SOURCE_PARSERS) {
            const score = parser.match(entry, peek);
            if (score > bestScore) {
                bestScore = score;
                winner = parser;
            }
        }

        if (!winner) {
            unmatched.push(entry);
            continue;
        }
        const list = matched.get(winner);
        if (list) list.push(entry);
        else matched.set(winner, [entry]);
    }

    return { matched, unmatched };
}

export interface ImportReadResult {
    threads: ParsedThread[];
    /** Files that were readable but belonged to no known service. */
    unrecognisedFiles: number;
}

/** Route a drop, then let each winning parser read what it claimed. */
export async function readThreads(entries: ImportEntry[]): Promise<ImportReadResult> {
    const ctx = buildArchiveContext(entries);
    const { matched, unmatched } = await routeEntries(entries);

    const threads: ParsedThread[] = [];
    for (const [parser, parserEntries] of matched) {
        try {
            // Stamped here rather than in each parser: it is routing that knows
            // which export a thread came out of.
            for (const thread of await parser.parse(parserEntries, ctx)) {
                threads.push({ ...thread, sourceId: parser.id });
            }
        } catch (error) {
            // One malformed service shouldn't sink an import that also carries a
            // perfectly good one.
            console.error(`Source parser "${parser.id}" failed:`, error);
        }
    }

    return { threads, unrecognisedFiles: unmatched.length };
}
