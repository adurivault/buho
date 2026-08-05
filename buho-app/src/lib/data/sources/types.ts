import type { Network, ParsedThreadDraft } from '$lib/types/messages';

/**
 * One file the user handed over, wherever it came from — a zip entry, a file
 * inside a picked folder, or a lone file. `text()` is lazy on purpose: a
 * messages export is mostly binary attachments, and none of them is ever read.
 */
export interface ImportEntry {
    /** Archive- or folder-relative, e.g. "messages/inbox/x/message_1.json". */
    path: string;
    /** Basename, e.g. "message_1.json". */
    name: string;
    text(): Promise<string>;
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

export interface SourceParser {
    /** Stable id, used in logs and tests. */
    id: string;
    label: string;
    /**
     * How confident this parser is that the entry is its own, from the path and
     * the first {@link PEEK_LENGTH} characters. 0 means "not mine"; the highest
     * score wins. Must stay cheap — it runs against every entry.
     */
    match(entry: ImportEntry, peek: string): number;
    /** Which network the matched entries belong to, given what surrounds them. */
    network(ctx: ArchiveContext): Network;
    /** Read the entries this parser won into threads. */
    parse(entries: ImportEntry[], ctx: ArchiveContext): Promise<ParsedThreadDraft[]>;
}

/** What a routing pass concluded, so the UI can report it. */
export interface RoutingResult {
    /** Entries grouped by the parser that claimed them. */
    matched: Map<SourceParser, ImportEntry[]>;
    /** Readable entries no parser recognised. */
    unmatched: ImportEntry[];
}
