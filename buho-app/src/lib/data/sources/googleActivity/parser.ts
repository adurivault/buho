import type { ActivityRow, RawMyActivityEntry } from '#lib/types/googleActivity.ts';
import type { ImportEntry, SourceParser } from '../types';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Local wall-clock rendering, "YYYY-MM-DD HH:MM:SS".
 *
 * Takeout timestamps are plain UTC instants with no offset attached, unlike the
 * Timeline export — so unlike `sources/googleTimeline/parse`, there is nothing here to
 * reconstruct the offset that was in force at the time. The browser's current
 * zone is the best available stand-in, and it is the right one for the common
 * case of reading your own export at home.
 */
function wallClock(iso: string): { timestamp: string; date: string } | null {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return {
        timestamp: `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
        date: day,
    };
}

function slug(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Verb prefixes Takeout writes, mapped to a stable action. Google's wording is
 * per-service and occasionally per-locale, so anything unrecognised is kept as
 * `other` with the title intact rather than guessed at.
 *
 * Order matters only where one prefix starts another; none currently does.
 */
const VERB_PREFIXES: ReadonlyArray<readonly [string, string]> = [
    ['Searched for ', 'searched'],
    ['Searched with ', 'searched'],
    ['Watched ', 'watched'],
    ['Viewed ', 'viewed'],
    ['Visited ', 'visited'],
    ['Directions to ', 'directions'],
    ['Explored on ', 'explored'],
    ['Subscribed to ', 'subscribed'],
    ['Saw articles in ', 'saw-articles'],
    ['Dismissed ', 'dismissed'],
    ['Translated ', 'translated'],
    ['Defined ', 'defined'],
    ['Prompted ', 'prompted'],
    ['Disliked ', 'disliked'],
    ['Downloaded ', 'downloaded'],
    ['Initiated ', 'initiated'],
    ['Opened ', 'opened'],
    ['Shared ', 'shared'],
    ['Voted ', 'voted'],
    ['Liked ', 'liked'],
    ['Used ', 'used'],
    ['Said ', 'said'],
];

function splitTitle(title: string): { action: string; label: string } {
    for (const [prefix, action] of VERB_PREFIXES) {
        if (title.startsWith(prefix)) {
            return { action, label: title.slice(prefix.length) };
        }
    }
    return { action: 'other', label: title };
}

/**
 * A Maps feature id, `0x<hex>:0x<hex>` — the same identifier the Timeline export
 * carries as `placeID`, which is what makes the two sources joinable.
 *
 * Google writes it in two interchangeable places and never in both at once: as
 * an `ftid` query parameter on short links, and inside the `data=` blob of a
 * full map URL, where it follows `!1s`.
 */
const FEATURE_ID = /(?:[?&]ftid=|!1s)(0x[0-9a-f]+:0x[0-9a-f]+)/i;

/**
 * The stable identifier an entry points at, when it has one: a YouTube video id,
 * or a Maps feature id.
 */
function targetIdOf(url: string): string | null {
    return /[?&]v=([\w-]{6,})/.exec(url)?.[1] ?? FEATURE_ID.exec(url)?.[1] ?? null;
}

/** Google's own properties: reaching one of these is not "leaving Google". */
const GOOGLE_HOST =
    /(^|\.)(google\.[a-z.]+|youtube\.com|youtu\.be|googleusercontent\.com|blogger\.com)$/;

/**
 * The host an entry left Google for, or null if it never did.
 *
 * Two things make this less direct than parsing the URL:
 *   - a followed search result is wrapped in a redirect, `google.com/url?q=<real
 *     url>`, so the destination has to be unwrapped out of the query string;
 *   - `www.` and mobile `m.` labels are dropped, so fr.wikipedia.org and
 *     fr.m.wikipedia.org don't sit as two unrelated destinations.
 */
export function externalDomain(rawUrl: string | null): string | null {
    if (!rawUrl) return null;

    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return null;
    }

    if (/^(www\.)?google\.[a-z.]+$/.test(url.hostname) && url.pathname === '/url') {
        const target = url.searchParams.get('q') ?? url.searchParams.get('url');
        if (!target) return null;
        try {
            url = new URL(target);
        } catch {
            return null;
        }
    }

    const host = url.hostname
        .toLowerCase()
        .replace(/^www\./, '')
        .replace(/(^|\.)m\./, '$1');

    return !host || GOOGLE_HOST.test(host) ? null : host;
}

/** The `@lat,lon` Google embeds in its own map URLs — the subject's position. */
function placeCoordsOf(url: string): { lat: number; lon: number } | null {
    const m = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(url);
    return m ? { lat: parseFloat(m[1]), lon: parseFloat(m[2]) } : null;
}

/** The `center=lat,lon` of a locationInfos URL — the user's approximate position. */
function userCoordsOf(url: string): { lat: number; lon: number } | null {
    const m = /[?&]center=(-?\d+\.\d+),(-?\d+\.\d+)/.exec(url);
    return m ? { lat: parseFloat(m[1]), lon: parseFloat(m[2]) } : null;
}

/**
 * Where a route started, from the first line of `description`.
 *
 * `description` carries two unrelated things depending on the service: a route's
 * "origin\ndestination" on Maps, and — on YouTube ads only — a single line
 * restating the hour already held by `time`. The line count tells them apart, so
 * the rule is shape-based rather than a service check: one line is never an
 * origin. Multi-stop routes list their waypoints below, and the first line is
 * still the start.
 */
function originOf(description: string | undefined): string | null {
    if (!description) return null;
    const lines = description.split('\n');
    if (lines.length < 2) return null;
    return lines[0].trim() || null;
}

/** One raw entry into a row, or null if it carries no usable timestamp. */
export function parseActivityEntry(entry: RawMyActivityEntry): ActivityRow | null {
    if (!entry.time) return null;
    const clock = wallClock(entry.time);
    if (!clock) return null;

    // `products` names the service; `header` is not a substitute — for Video
    // Search it holds the domain that was searched ("youtube.com", "tf1.fr").
    const service = slug(entry.products?.[0] ?? entry.header ?? 'unknown') || 'unknown';
    const { action, label } = splitTitle(entry.title ?? '');

    const url = entry.titleUrl ?? null;
    const place = url ? placeCoordsOf(url) : null;

    const locationInfo = entry.locationInfos?.[0];
    const user = locationInfo?.url ? userCoordsOf(locationInfo.url) : null;

    return {
        timestamp: clock.timestamp,
        date: clock.date,
        service,
        action,
        label,
        secondary: entry.subtitles?.[0]?.name ?? null,
        secondaryUrl: entry.subtitles?.[0]?.url ?? null,
        targetId: url ? targetIdOf(url) : null,
        url,
        domain: externalDomain(url),
        origin: originOf(entry.description),
        placeLat: place?.lat ?? null,
        placeLon: place?.lon ?? null,
        lat: user?.lat ?? null,
        lon: user?.lon ?? null,
        locSource: user ? (locationInfo?.source ?? null) : null,
        isAd: entry.details?.some((d) => d.name === 'From Google Ads') ?? false,
    };
}

export const googleActivityParser: SourceParser<'activity'> = {
    id: 'google-activity',
    label: 'Google Takeout (My Activity)',
    dataset: 'activity',

    match(entry: ImportEntry, peek: string): number {
        // Shape is required, never the path alone: a Takeout also ships plenty of
        // unrelated JSON, and claiming those would swallow them silently.
        const looksLikeActivity =
            /^\s*\[\s*\{/.test(peek) &&
            peek.includes('"header"') &&
            peek.includes('"title"') &&
            peek.includes('"time"');
        if (!looksLikeActivity) return 0;

        // Takeout names every one of these files "My Activity.json"; a renamed or
        // hand-split export still matches on shape, just less confidently.
        return /my ?activity/i.test(entry.path) ? 3 : 2;
    },

    async parse(entries: ImportEntry[]): Promise<ActivityRow[]> {
        const rows: ActivityRow[] = [];

        // One file at a time, and nothing kept from it beyond the rows: a single
        // service file runs to tens of megabytes, and a full export holds several.
        for (const entry of entries) {
            let parsed: unknown;
            try {
                parsed = JSON.parse(await entry.text());
            } catch {
                continue; // a damaged service file shouldn't sink the whole export
            }
            if (!Array.isArray(parsed)) continue;

            for (const raw of parsed as RawMyActivityEntry[]) {
                const row = parseActivityEntry(raw);
                if (row) rows.push(row);
            }
        }

        return rows;
    },
};
