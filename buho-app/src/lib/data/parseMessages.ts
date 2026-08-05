import type { MessageRow, RawMessageThread } from '$lib/types/messages';
import { buildMessageRows } from './import/buildRows';
import { normalizedJsonParser, parseNormalizedThread } from './sources/normalizedJson';

export { REACTION_SEPARATOR } from './import/buildRows';

/**
 * Parse converted Messenger exports (one object per conversation) into flat rows.
 *
 * Kept as a direct entry point for callers holding already-parsed JSON objects —
 * chiefly the tests. The import pipeline itself goes through the source registry
 * (`sources/registry.ts`), which detects the format instead of assuming it.
 *
 * @throws {Error} if jsonData is null, undefined, or not an array.
 */
export function parseMessagesData(jsonData: RawMessageThread[]): MessageRow[] {
    if (jsonData === null || jsonData === undefined) {
        throw new Error('parseMessagesData: input cannot be null or undefined');
    }
    if (!Array.isArray(jsonData)) {
        throw new Error('parseMessagesData: input must be an array');
    }

    const threads = jsonData
        .map((thread) => parseNormalizedThread(thread))
        .filter((thread) => thread !== null)
        .map((thread) => ({ ...thread, sourceId: normalizedJsonParser.id }));

    return buildMessageRows(threads).rows;
}
