import type { SqlNumber, SqlText } from './common';
import { query } from '#lib/data/db/index.ts';
import type { ConnectablePoint } from '#lib/data/queries/behaviorQueries.ts';
import type { SearchablePoint } from '#lib/explorer/search.ts';

// ---------------------------------------------------------------------------
// Explorer base points
// ---------------------------------------------------------------------------

/** Human labels for the service slugs, so the pies don't read like table keys. */
export const SERVICE_LABELS: Record<string, string> = {
    youtube: 'YouTube',
    search: 'Search',
    maps: 'Maps',
    'image-search': 'Image search',
    'video-search': 'Video search',
    hotels: 'Hotels',
    flights: 'Flights',
    'google-translate': 'Translate',
    'google-news': 'News',
    'google-lens': 'Lens',
    'google-play-store': 'Play Store',
    'gemini-apps': 'Gemini',
    'ai-mode': 'AI Mode',
};

export const serviceLabel = (slug: string): string =>
    SERVICE_LABELS[slug] ?? slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * Leading words that group nothing. A search starting with an article would
 * otherwise put "la", "le" and "the" among the biggest buckets, which says
 * nothing about what was looked for.
 */
const LEADING_STOPWORDS = new Set([
    'le',
    'la',
    'les',
    'un',
    'une',
    'des',
    'du',
    'de',
    "l'",
    "d'",
    'the',
    'a',
    'an',
    'my',
    'how',
    'what',
]);

/**
 * First meaningful word of a query, for the sunburst's grouping ring.
 *
 * Returns '' — so the level is skipped rather than shown empty — for anything
 * that isn't a multi-word search: on a one-word query the first word *is* the
 * query, and a ring repeating the one below it is just noise.
 */
export function queryFirstWord(action: string, label: string): string {
    if (action !== 'searched') return '';
    const words = label.split(/\s+/).filter(Boolean);
    if (words.length < 2) return '';

    const clean = (w: string) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    for (const word of words) {
        const c = clean(word);
        if (c && !LEADING_STOPWORDS.has(c)) return c;
    }
    return clean(words[0]);
}

export interface ActivityBasePoint extends ConnectablePoint, SearchablePoint {
    actId: number;
    fService: string;
    fAction: string;
    /** "Ad" | "Organic" — 4 k ad rows in a typical export skew every top list. */
    fAd: string;
    /** "Located" | "No location" — only a slice of entries carry coordinates. */
    fLocated: string;
    dow: string;
    year: string;
    label: string;
    secondary: string;
    /** Host the entry left Google for; '' when it stayed inside Google. */
    fDomain: string;
    /** Where a route started; '' when the entry isn't an itinerary. */
    fOrigin: string;
    /** First meaningful word of a multi-word query; '' otherwise. */
    fFirstWord: string;
    /**
     * Google's own link for the entry. Opening it hands Google back a record it
     * produced itself, on an explicit click — the privacy invariant is about user
     * data never reaching Buho or a third party, which this isn't.
     */
    url: string | null;
}

/**
 * All constellation points, loaded ONCE. The point set never changes with the
 * filters (`matched` is recomputed in JS), which avoids rebuilding the quadtree
 * on every interaction — same contract as the two other explorers.
 *
 * Every service lands in the same set on purpose: the whole point of stacking
 * them is seeing a search, a video and a map lookup on one timeline.
 */
export async function getActivityBasePoints(): Promise<ActivityBasePoint[]> {
    const sql = `
        SELECT
            act_id as actId,
            CAST(epoch(DATE(timestamp)) * 1000 AS BIGINT) as x,
            CAST(hour(timestamp) + (minute(timestamp) / 60.0) + (second(timestamp) / 3600.0) AS DOUBLE) as y,
            CAST(timestamp AS VARCHAR) as happenedAt,
            service as fService,
            COALESCE(NULLIF(TRIM(action), ''), 'other') as fAction,
            CASE WHEN is_ad THEN 'Ad' ELSE 'Organic' END as fAd,
            CASE WHEN lat IS NOT NULL THEN 'Located' ELSE 'No location' END as fLocated,
            CAST(DAYOFWEEK(timestamp) AS VARCHAR) as dow,
            CAST(YEAR(timestamp) AS VARCHAR) as year,
            COALESCE(label, '') as label,
            COALESCE(secondary, '') as secondary,
            COALESCE(domain, '') as fDomain,
            COALESCE(origin, '') as fOrigin,
            url
        FROM google_activity
        WHERE timestamp IS NOT NULL
        ORDER BY x ASC
    `;

    try {
        const result = await query<{
            actId: SqlNumber;
            x: SqlNumber;
            y: SqlNumber;
            happenedAt: string;
            fService: string;
            fAction: string;
            fAd: string;
            fLocated: string;
            dow: string;
            year: string;
            label: string;
            secondary: string;
            fDomain: string;
            fOrigin: string;
            url: SqlText;
        }>(sql);
        return result.map((row) => ({
            actId: Number(row.actId) || 0,
            x: Number(row.x),
            y: Number(row.y),
            matched: true,
            metadata: {
                service: row.fService,
                action: row.fAction,
                label: row.label,
                secondary: row.secondary,
                happenedAt: row.happenedAt,
                url: row.url ?? null,
            },
            fService: row.fService ?? 'unknown',
            fAction: row.fAction ?? 'other',
            fAd: row.fAd,
            fLocated: row.fLocated,
            dow: String(row.dow),
            year: String(row.year),
            label: row.label ?? '',
            secondary: row.secondary ?? '',
            fDomain: row.fDomain ?? '',
            fOrigin: row.fOrigin ?? '',
            fFirstWord: queryFirstWord(row.fAction ?? '', row.label ?? ''),
            url: row.url ?? null,
            searchTerm: '',
            searchMask: 0,
        }));
    } catch (error) {
        console.error('Failed to load activity base points:', error);
        return [];
    }
}

/** [min, max] of the stored days, in epoch ms — the constellation's x domain. */
export async function getActivityTimeDomain(): Promise<[number, number] | null> {
    const sql = `
        SELECT
            CAST(epoch(DATE(MIN(timestamp))) * 1000 AS BIGINT) as lo,
            CAST(epoch(DATE(MAX(timestamp))) * 1000 AS BIGINT) as hi
        FROM google_activity
        WHERE timestamp IS NOT NULL
    `;

    try {
        const [row] = await query<{ lo: SqlNumber; hi: SqlNumber }>(sql);
        if (!row || row.lo == null || row.hi == null) return null;
        return [Number(row.lo), Number(row.hi)];
    } catch {
        return null;
    }
}
