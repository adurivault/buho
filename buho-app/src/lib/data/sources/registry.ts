import type { HealthReading } from '#lib/types/health.ts';
import type { GaitReading, StepPacket } from '#lib/types/steps.ts';
import type { ActivityRow } from '#lib/types/googleActivity.ts';
import type { LocationSegment } from '#lib/types/positions.ts';
import type { ParsedThread } from '#lib/types/messages.ts';
import type { Play } from '#lib/types/play.ts';
import type { AnySourceParser, ArchiveContext, ImportEntry, RoutingResult } from './types';
import { PEEK_LENGTH } from './types';
import { appleHealthParser } from './appleHealth/parser';
import { deezerXlsxParser } from './deezer/parser';
import { garminFitParser } from './garmin/parser';
import { googleActivityParser } from './googleActivity/parser';
import { googleTimelineParser } from './googleTimeline/parser';
import { lastfmJsonParser } from './lastfm/parser';
import { metaJsonParser } from './metaJson/parser';
import { normalizedJsonParser } from './normalizedJson/parser';
import { spotifyJsonParser } from './spotify/parser';
import { stravaParser } from './strava/parser';
import { whatsappTextParser } from './whatsappText/parser';

/**
 * Every source Buho can read. Adding a service is one module plus one line
 * here — the importer, the derivation and the storage layer don't move.
 */
export const SOURCE_PARSERS: AnySourceParser[] = [
    metaJsonParser,
    normalizedJsonParser,
    whatsappTextParser,
    googleActivityParser,
    googleTimelineParser,
    garminFitParser,
    appleHealthParser,
    stravaParser,
    spotifyJsonParser,
    deezerXlsxParser,
    lastfmJsonParser,
];

/** Only these are ever opened; everything else is an attachment. */
const READABLE = /\.(json|txt|gpx|tcx)$/i;
/**
 * Formats routed on their path alone, without a peek.
 *
 * Two reasons land a format here, and both come out the same way. Some have no
 * head a `match` could read: Garmin's `.fit`, Deezer's `.xlsx` — itself a zip —
 * and the `.gz` Strava wraps each of its tracks in. The rest have one and nobody
 * sniffs it: a `.gpx` or a `.tcx` is claimed on its extension, since no other
 * export Buho reads ships either.
 *
 * Skipping the peek is what makes that free. A zip member cannot be inflated by
 * prefix, so peeking one decompresses it whole — and a Strava export is several
 * hundred track files, every one of which the parser then reads again. Apple
 * Health's `export.xml` is the extreme case: one file of hundreds of megabytes.
 */
const NO_PEEK = /\.(fit|xlsx|gpx|tcx)$|\.(fit|gpx|tcx)\.gz$|^export\.xml$/i;

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
    const matched = new Map<AnySourceParser, ImportEntry[]>();
    const unmatched: ImportEntry[] = [];

    for (const entry of entries) {
        const routedByPath = NO_PEEK.test(entry.name);
        if (!routedByPath && !READABLE.test(entry.name)) continue;

        let peek = '';
        if (!routedByPath) {
            try {
                peek = await entry.peek(PEEK_LENGTH);
            } catch {
                continue; // unreadable entry: not something to report as unrecognised
            }
        }

        let winner: AnySourceParser | null = null;
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

/**
 * Everything one drop yielded, grouped by dataset. A single folder can carry
 * several at once — a Takeout next to a Messenger archive — so this is a record
 * of what was found, not a verdict on what the drop "is".
 */
export interface DropResult {
    threads: ParsedThread[];
    activity: ActivityRow[];
    /** Recorded positions, from every provider in the drop. */
    positions: LocationSegment[];
    steps: StepPacket[];
    /** How those steps were walked, measured by a phone during the walk. */
    gait: GaitReading[];
    /** Heart rate, stress and the rest, riding in on the same monitoring files. */
    health: HealthReading[];
    /** Plays, from every music service in the drop. */
    plays: Play[];
    /** Files that were readable but belonged to no known service. */
    unrecognisedFiles: number;
    /**
     * Parsers that claimed files and then threw, in `SOURCE_PARSERS` id form.
     *
     * A failure here is survivable — the other services in the drop still land —
     * which is exactly why it has to be reported: the import looks successful
     * and simply misses a dataset, and nothing downstream would ever know.
     */
    failedParsers: string[];
}

/**
 * Append one array to another without spreading it.
 *
 * `target.push(...source)` passes every element as an argument, and an engine
 * caps how many a call may take — a Garmin export yields ~300k track points in
 * one parse, which overflows the stack rather than failing gracefully.
 */
function appendAll<T>(target: T[], source: T[]): void {
    const CHUNK = 10_000;
    for (let i = 0; i < source.length; i += CHUNK) {
        target.push(...source.slice(i, i + CHUNK));
    }
}

/** Route a drop, then let each winning parser read what it claimed. */
export async function readDrop(entries: ImportEntry[]): Promise<DropResult> {
    const ctx = buildArchiveContext(entries);
    const { matched, unmatched } = await routeEntries(entries);

    const result: DropResult = {
        threads: [],
        activity: [],
        positions: [],
        steps: [],
        gait: [],
        health: [],
        plays: [],
        unrecognisedFiles: unmatched.length,
        failedParsers: [],
    };

    for (const [parser, parserEntries] of matched) {
        try {
            // Branching before the call rather than casting after it: `dataset`
            // discriminates the parser union, so each arm knows its payload type.
            if (parser.dataset === 'messages') {
                // `sourceId` is stamped here rather than in each parser: it is
                // routing that knows which export a thread came out of.
                for (const thread of await parser.parse(parserEntries, ctx)) {
                    result.threads.push({ ...thread, sourceId: parser.id });
                }
            } else if (parser.dataset === 'positions') {
                appendAll(result.positions, await parser.parse(parserEntries, ctx));
            } else if (parser.dataset === 'listening') {
                // Every music service lands in the same bucket, each row already
                // carrying its own `source`.
                appendAll(result.plays, await parser.parse(parserEntries, ctx));
            } else if (parser.dataset === 'monitoring') {
                // The exports that yield several datasets at once — Garmin's
                // tracks land in the same bucket as Google Timeline's.
                const { positions, steps, gait, health } = await parser.parse(parserEntries, ctx);
                appendAll(result.positions, positions);
                appendAll(result.steps, steps);
                appendAll(result.gait, gait);
                appendAll(result.health, health);
            } else {
                appendAll(result.activity, await parser.parse(parserEntries, ctx));
            }
        } catch (error) {
            // One malformed service shouldn't sink an import that also carries a
            // perfectly good one — it is reported instead, see `failedParsers`.
            console.error(`Source parser "${parser.id}" failed:`, error);
            result.failedParsers.push(parser.id);
        }
    }

    return result;
}
