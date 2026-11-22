import { describe, it, expect } from 'vitest';
import { externalDomain, googleActivityParser, parseActivityEntry } from './parser';
import { routeEntries } from '../registry';
import type { ImportEntry } from '../types';
import type { RawMyActivityEntry } from '#lib/types/googleActivity.ts';

function entry(path: string, content: string): ImportEntry {
    return {
        path,
        name: path.split('/').pop() ?? path,
        peek: async (length) => content.slice(0, length),
        text: async () => content,
        bytes: async () => new TextEncoder().encode(content),
    };
}

/** One entry per service, in the shape Takeout actually ships. */
const YOUTUBE: RawMyActivityEntry = {
    header: 'YouTube',
    title: 'Watched Did an AI Really Hack Hugging Face?',
    titleUrl: 'https://www.youtube.com/watch?v=q2KCrmQz9WE',
    subtitles: [{ name: 'LiveOverflow', url: 'https://www.youtube.com/channel/UClcE' }],
    time: '2026-07-29T11:03:00.703Z',
    products: ['YouTube'],
    activityControls: ['YouTube watch history'],
};

const MAPS_SEARCH: RawMyActivityEntry = {
    header: 'Maps',
    title: 'Searched for Yonne',
    titleUrl:
        'https://www.google.fr/maps/place//@47.8552033,3.5943699,8z/data=!4m2!3m1!1s0x47ee4feff2f737df:0x309ce34b30d2b10',
    time: '2026-07-29T10:59:30.361Z',
    products: ['Maps'],
    locationInfos: [
        {
            name: 'At this general area',
            url: 'https://www.google.com/maps/@?api=1&map_action=map&center=48.856600,2.352200&zoom=12',
            source: 'From your device',
        },
    ],
};

const SEARCH_AD: RawMyActivityEntry = {
    header: 'YouTube',
    title: 'Watched Better Than Delivery | Shop Anyday Glass Cookware',
    titleUrl: 'https://www.youtube.com/watch?v=Cg6C_IsFIj8',
    time: '2026-06-12T20:02:07.948Z',
    products: ['YouTube'],
    details: [{ name: 'From Google Ads' }],
    // Only ever present on ads, and only restating the hour already in `time`.
    description: 'Watched at 22:02',
};

describe('parseActivityEntry', () => {
    it('splits the verb from its subject', () => {
        const row = parseActivityEntry(YOUTUBE)!;
        expect(row.action).toBe('watched');
        expect(row.label).toBe('Did an AI Really Hack Hugging Face?');
    });

    it('keeps the video id and the channel', () => {
        const row = parseActivityEntry(YOUTUBE)!;
        expect(row.targetId).toBe('q2KCrmQz9WE');
        expect(row.secondary).toBe('LiveOverflow');
        expect(row.secondaryUrl).toContain('/channel/UClcE');
    });

    /**
     * The feature id is what makes activity joinable with the Timeline, where the
     * same string appears as `placeID`. Google writes it either as an `ftid`
     * parameter or inside the `data=` blob after `!1s`, never both — so missing
     * one form silently halves the join.
     */
    it.each([
        [
            'inside data=',
            'https://www.google.fr/maps/place//@47.8552033,3.5943699,8z/data=!4m2!3m1!1s0x47ee4feff2f737df:0x309ce34b30d2b10',
        ],
        [
            'as an ftid parameter',
            'https://maps.google.com?q=Yonne&ftid=0x47ee4feff2f737df:0x309ce34b30d2b10',
        ],
    ])('takes the Maps feature id %s', (_form, titleUrl) => {
        const row = parseActivityEntry({ ...MAPS_SEARCH, titleUrl })!;
        expect(row.targetId).toBe('0x47ee4feff2f737df:0x309ce34b30d2b10');
    });

    /**
     * The two coordinate pairs answer different questions and must not be
     * conflated: one is the place looked at, the other roughly where the user was.
     */
    it('separates the place looked at from where the user was', () => {
        const row = parseActivityEntry(MAPS_SEARCH)!;
        expect(row.placeLat).toBeCloseTo(47.8552033);
        expect(row.placeLon).toBeCloseTo(3.5943699);
        expect(row.lat).toBeCloseTo(48.8566);
        expect(row.lon).toBeCloseTo(2.3522);
        expect(row.locSource).toBe('From your device');
    });

    it('leaves both coordinate pairs null when neither is given', () => {
        const row = parseActivityEntry(YOUTUBE)!;
        expect(row.placeLat).toBeNull();
        expect(row.lat).toBeNull();
        expect(row.locSource).toBeNull();
    });

    it('flags ads and ignores their redundant description', () => {
        const row = parseActivityEntry(SEARCH_AD)!;
        expect(row.isAd).toBe(true);
        expect(parseActivityEntry(YOUTUBE)!.isAd).toBe(false);
        // Nothing from `description` reaches the row.
        expect(JSON.stringify(row)).not.toContain('Watched at');
    });

    it('names the service from products, not from header', () => {
        // For Video Search, `header` is the domain that was searched.
        const row = parseActivityEntry({
            header: 'tf1.fr',
            title: 'Watched Something',
            time: '2025-06-21T21:59:42Z',
            products: ['Video Search'],
        })!;
        expect(row.service).toBe('video-search');
    });

    it('falls back to header when products is missing', () => {
        const row = parseActivityEntry({
            header: 'Image Search',
            title: 'Searched for murier platane',
            time: '2026-07-21T08:51:03Z',
        })!;
        expect(row.service).toBe('image-search');
    });

    it('keeps an unrecognised verb rather than guessing', () => {
        // Maps entries are often a bare place name with no verb at all.
        const row = parseActivityEntry({
            header: 'Maps',
            title: 'Yonne',
            time: '2026-07-29T10:59:31.069Z',
            products: ['Maps'],
        })!;
        expect(row.action).toBe('other');
        expect(row.label).toBe('Yonne');
    });

    it('renders a local wall-clock, matching the other sources', () => {
        const row = parseActivityEntry(YOUTUBE)!;
        expect(row.timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        expect(row.date).toBe(row.timestamp.slice(0, 10));
        // Same instant, rendered in whatever zone the test runs in.
        expect(row.timestamp.slice(0, 10)).toBe(
            new Date(YOUTUBE.time!).toLocaleDateString('sv-SE')
        );
    });

    it('drops an entry with no usable time', () => {
        expect(parseActivityEntry({ header: 'Maps', title: 'Yonne' })).toBeNull();
        expect(parseActivityEntry({ ...YOUTUBE, time: 'not a date' })).toBeNull();
    });
});

describe('googleActivityParser', () => {
    const file = (rows: RawMyActivityEntry[]) => JSON.stringify(rows);

    it('claims a Takeout activity file', async () => {
        const content = file([YOUTUBE]);
        const { matched, unmatched } = await routeEntries([
            entry('Takeout/My Activity/YouTube/My Activity.json', content),
        ]);
        expect([...matched.keys()].map((p) => p.id)).toEqual(['google-activity']);
        expect(unmatched).toHaveLength(0);
    });

    it('needs the shape, not just the path', async () => {
        const { matched, unmatched } = await routeEntries([
            entry('Takeout/My Activity/Chrome/Settings.json', '{"theme":"dark"}'),
        ]);
        expect(matched.size).toBe(0);
        expect(unmatched.map((e) => e.name)).toEqual(['Settings.json']);
    });

    it('claims a renamed export on shape alone', () => {
        const content = file([YOUTUBE]);
        expect(googleActivityParser.match(entry('export.json', content), content)).toBeGreaterThan(
            0
        );
    });

    it('reads several service files into one flat list', async () => {
        const rows = await googleActivityParser.parse(
            [
                entry('My Activity/YouTube/My Activity.json', file([YOUTUBE, SEARCH_AD])),
                entry('My Activity/Maps/My Activity.json', file([MAPS_SEARCH])),
            ],
            { paths: [], hasPathSegment: () => false }
        );

        expect(rows).toHaveLength(3);
        expect(new Set(rows.map((r) => r.service))).toEqual(new Set(['youtube', 'maps']));
    });

    it('skips a damaged service file instead of losing the export', async () => {
        const rows = await googleActivityParser.parse(
            [
                entry('My Activity/Search/My Activity.json', '[{"header":"Search",'),
                entry('My Activity/YouTube/My Activity.json', file([YOUTUBE])),
            ],
            { paths: [], hasPathSegment: () => false }
        );

        expect(rows).toHaveLength(1);
        expect(rows[0].service).toBe('youtube');
    });
});

describe('originOf (via parseActivityEntry)', () => {
    const directions = (description?: string) => ({
        header: 'Maps',
        title: 'Directions to Auray, Pl. Raoul Dautry, 56400 Auray',
        time: '2026-07-29T08:34:04.961Z',
        products: ['Maps'],
        description,
    });

    it('takes the origin from the first line', () => {
        const row = parseActivityEntry(
            directions('Current location\nAuray, Pl. Raoul Dautry, 56400 Auray')
        )!;
        expect(row.origin).toBe('Current location');
        // The destination is already the label; it is not duplicated.
        expect(row.label).toBe('Auray, Pl. Raoul Dautry, 56400 Auray');
    });

    it('keeps the start of a multi-stop route', () => {
        const row = parseActivityEntry(directions('Lyon\nValence\nMarseille'))!;
        expect(row.origin).toBe('Lyon');
    });

    /**
     * `description` means two unrelated things: a route on Maps, and on YouTube
     * ads a lone line restating the hour already in `time`. Telling them apart by
     * line count rather than by service is what keeps "Watched at 20:41" from
     * being read as a departure point.
     */
    it('reads nothing from a single-line description', () => {
        const row = parseActivityEntry({
            header: 'YouTube',
            title: 'Watched Something',
            time: '2026-06-12T20:02:07.948Z',
            products: ['YouTube'],
            description: 'Watched at 22:02',
        })!;
        expect(row.origin).toBeNull();
    });

    it('is null when there is no description at all', () => {
        expect(parseActivityEntry(directions())!.origin).toBeNull();
    });
});

describe('externalDomain', () => {
    it('unwraps the redirect Google puts on a followed search result', () => {
        // The stored URL is google.com/url?q=<destination>, so reading the
        // hostname straight off it would say "google.com" for every visit.
        expect(
            externalDomain(
                'https://www.google.com/url?q=https://fr.wikipedia.org/wiki/Palais_du_Pharo&usg=AOv'
            )
        ).toBe('fr.wikipedia.org');
    });

    it('folds the mobile host into the desktop one', () => {
        expect(externalDomain('https://fr.m.wikipedia.org/wiki/X')).toBe('fr.wikipedia.org');
        expect(externalDomain('https://m.youtube.com/watch?v=x')).toBeNull();
    });

    it('says nothing for an entry that never left Google', () => {
        for (const url of [
            'https://www.youtube.com/watch?v=q2KCrmQz9WE',
            'https://www.google.fr/maps/place//@47.85,3.59,8z',
            'https://support.google.com/maps/answer/3184808',
            'https://www.google.com/search?q=duckdb',
        ]) {
            expect(externalDomain(url)).toBeNull();
        }
    });

    it('keeps a plain third-party link and drops www', () => {
        expect(externalDomain('https://www.stackoverflow.com/q/1')).toBe('stackoverflow.com');
        expect(externalDomain('https://github.com/duckdb')).toBe('github.com');
    });

    it('handles a missing or unparseable URL', () => {
        expect(externalDomain(null)).toBeNull();
        expect(externalDomain('not a url')).toBeNull();
        expect(externalDomain('https://www.google.com/url?usg=nothing')).toBeNull();
    });
});
