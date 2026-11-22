import type { HealthReading } from '#lib/types/health.ts';
import type { StepPacket } from '#lib/types/steps.ts';
import type { ActivityRow } from '#lib/types/googleActivity.ts';
import type { LocationSegment } from '#lib/types/positions.ts';
import type { Network, ParsedThreadDraft } from '#lib/types/messages.ts';
import type { Play } from '#lib/types/play.ts';

/**
 * One file the user handed over, wherever it came from — a zip entry, a file
 * inside a picked folder, or a lone file. Reading is lazy on purpose: a
 * messages export is mostly binary attachments, and none of them is ever read.
 */
export interface ImportEntry {
    /** Archive- or folder-relative, e.g. "messages/inbox/x/message_1.json". */
    path: string;
    /** Basename, e.g. "message_1.json". */
    name: string;
    /**
     * The first `length` characters, for routing.
     *
     * Routing sniffs *every* entry in the drop, so this must neither memoize nor
     * — where the backing store allows it — materialize more than the head.
     * A Takeout folder is a handful of files tens of megabytes each; caching
     * their heads would mean holding the whole import in memory before a single
     * row is parsed.
     */
    peek(length: number): Promise<string>;
    /** The full contents. Read once, by the parser that claimed the entry. */
    text(): Promise<string>;
    /** The raw bytes. Read once, by the parser that claimed the entry. */
    bytes(): Promise<Uint8Array>;
    /**
     * True for formats that are not text at all — Garmin's `.fit` files.
     *
     * Routing skips the peek for these: the head of a binary file says nothing a
     * `match` could use, and a zip member cannot be inflated by prefix, so
     * peeking one would decompress it whole just to throw the result away.
     * A binary entry is claimed on its path, then read through `bytes`.
     */
    binary?: boolean;
}

/**
 * What surrounds an entry in the same drop. Some questions can't be answered by
 * one file alone: a Messenger thread and an Instagram thread are byte-for-byte
 * the same schema, and only the paths around them say which service it is.
 */
export interface ArchiveContext {
    /** Every path in the drop, lowercased. */
    paths: string[];
    /** True if any path contains the segment. */
    hasPathSegment(segment: string): boolean;
}

/** Number of leading characters a parser gets to sniff before committing. */
export const PEEK_LENGTH = 2048;

/**
 * The kinds of data a drop can yield. Routing is shared across all of them —
 * one dropped folder can hold a Messenger archive next to a Google Takeout — but
 * storage is not: each dataset has its own table and its own columns.
 */
export type Dataset = 'messages' | 'activity' | 'positions' | 'garmin' | 'listening';

/**
 * What one Garmin export yields.
 *
 * The only parser that feeds two datasets at once, because a Garmin export is a
 * single family of `.fit` files that happens to carry both: routing hands each
 * file to exactly one parser, so splitting this in two would mean decoding all
 * ten thousand of them twice.
 */
export interface GarminPayload {
    positions: LocationSegment[];
    steps: StepPacket[];
    health: HealthReading[];
}

/** What a parser of each dataset hands back. */
export interface DatasetPayload {
    messages: ParsedThreadDraft[];
    activity: ActivityRow[];
    positions: LocationSegment[];
    garmin: GarminPayload;
    listening: Play[];
}

export interface SourceParser<D extends Dataset = Dataset> {
    /** Stable id, used in logs and tests. */
    id: string;
    label: string;
    /** Which dataset this parser feeds, and so what `parse` returns. */
    dataset: D;
    /**
     * How confident this parser is that the entry is its own, from the path and
     * the first {@link PEEK_LENGTH} characters. 0 means "not mine"; the highest
     * score wins. Must stay cheap — it runs against every entry.
     */
    match(entry: ImportEntry, peek: string): number;
    /** Read the entries this parser won. */
    parse(entries: ImportEntry[], ctx: ArchiveContext): Promise<DatasetPayload[D]>;
}

/**
 * A messages parser additionally has to name the service its threads belong to,
 * which only the surrounding paths can answer. Specific to this dataset: nothing
 * else in an export has an equivalent question.
 */
export interface MessagesSourceParser extends SourceParser<'messages'> {
    network(ctx: ArchiveContext): Network;
}

/** Any registered parser. Discriminated by `dataset`. */
export type AnySourceParser =
    | MessagesSourceParser
    | SourceParser<'activity'>
    | SourceParser<'positions'>
    | SourceParser<'garmin'>
    | SourceParser<'listening'>;

/** What a routing pass concluded, so the UI can report it. */
export interface RoutingResult {
    /** Entries grouped by the parser that claimed them. */
    matched: Map<AnySourceParser, ImportEntry[]>;
    /** Readable entries no parser recognised. */
    unmatched: ImportEntry[];
}
