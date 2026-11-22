import { describe, it, expect } from 'vitest';
import {
    buildSunburstHierarchy,
    buildPathHierarchy,
    bucketByDegree,
    nodeTotal,
    type SunburstNode,
} from './sunburstHierarchy';
import type { ArtistSunburstRow } from '#lib/data/queries/artistQueries.ts';

describe('buildSunburstHierarchy', () => {
    it('builds a full 3-level tree from flat rows', () => {
        const rows: ArtistSunburstRow[] = [
            {
                artist: 'Artist A',
                album: 'Album A',
                track: 'Song 1',
                minutes: 100,
                playCount: 30,
                trackUri: 'spotify:track:1',
            },
            {
                artist: 'Artist A',
                album: 'Album A',
                track: 'Song 2',
                minutes: 50,
                playCount: 15,
                trackUri: null,
            },
            {
                artist: 'Artist A',
                album: 'Album B',
                track: 'Song 3',
                minutes: 40,
                playCount: 12,
                trackUri: null,
            },
            {
                artist: 'Artist B',
                album: 'Album C',
                track: 'Song 4',
                minutes: 80,
                playCount: 25,
                trackUri: null,
            },
        ];

        const root = buildSunburstHierarchy(rows);

        expect(root.children).toHaveLength(2);
        const artistA = root.children![0];
        expect(artistA.name).toBe('Artist A');
        expect(artistA.children).toHaveLength(2);
        expect(artistA.children![0].children).toHaveLength(2);
        expect(artistA.children![0].children![0]).toEqual({
            name: 'Song 1',
            value: 100,
            playCount: 30,
            trackUri: 'spotify:track:1',
        });
    });

    it('sizes arcs by plays when asked, keeping minutes on the leaf', () => {
        // The two measures rank differently on purpose: a long track played once
        // outweighs a short one played often by time, and loses by plays.
        const rows: ArtistSunburstRow[] = [
            {
                artist: 'Long',
                album: 'A',
                track: 'Epic',
                minutes: 100,
                playCount: 2,
                trackUri: null,
            },
            {
                artist: 'Short',
                album: 'B',
                track: 'Jingle',
                minutes: 20,
                playCount: 40,
                trackUri: null,
            },
        ];

        const byPlays = buildSunburstHierarchy(rows, 'plays');

        expect(nodeTotal(byPlays.children![0])).toBe(2);
        expect(nodeTotal(byPlays.children![1])).toBe(40);
        // playCount still rides along, so a tooltip can show both.
        expect(byPlays.children![1].children![0].children![0].playCount).toBe(40);
    });

    it('defaults to minutes, so the ranking flips between the two', () => {
        const rows: ArtistSunburstRow[] = [
            {
                artist: 'Long',
                album: 'A',
                track: 'Epic',
                minutes: 100,
                playCount: 2,
                trackUri: null,
            },
            {
                artist: 'Short',
                album: 'B',
                track: 'Jingle',
                minutes: 20,
                playCount: 40,
                trackUri: null,
            },
        ];

        const byMinutes = buildSunburstHierarchy(rows);

        expect(nodeTotal(byMinutes.children![0])).toBe(100);
        expect(nodeTotal(byMinutes.children![1])).toBe(20);
    });

    it('keeps a play whose duration was never recorded, weightless but counted', () => {
        // Deezer writes no duration for some of its oldest plays. In "plays" mode
        // they must still count; in "time" mode they simply weigh nothing.
        const rows: ArtistSunburstRow[] = [
            {
                artist: 'Yuksek',
                album: 'On A Train EP',
                track: 'On A Train',
                minutes: 0,
                playCount: 3,
                trackUri: null,
            },
        ];

        expect(nodeTotal(buildSunburstHierarchy(rows, 'plays'))).toBe(3);
        expect(nodeTotal(buildSunburstHierarchy(rows, 'minutes'))).toBe(0);
    });

    it('does not merge identical album names across artists', () => {
        const rows: ArtistSunburstRow[] = [
            {
                artist: 'Artist A',
                album: 'Greatest Hits',
                track: 'Song 1',
                minutes: 10,
                playCount: 3,
                trackUri: null,
            },
            {
                artist: 'Artist B',
                album: 'Greatest Hits',
                track: 'Song 2',
                minutes: 12,
                playCount: 4,
                trackUri: null,
            },
        ];

        const root = buildSunburstHierarchy(rows);

        expect(root.children).toHaveLength(2);
        expect(root.children![0].children![0].name).toBe('Greatest Hits');
        expect(root.children![1].children![0].name).toBe('Greatest Hits');
        expect(root.children![0].children![0].children![0].name).toBe('Song 1');
        expect(root.children![1].children![0].children![0].name).toBe('Song 2');
    });
});

describe('buildPathHierarchy', () => {
    const lvl = (name: string, key: string) => ({ name, key });

    it('builds a full path, tags each node with its filterKey, and sums values', () => {
        const fr = [
            lvl('France', 'country'),
            lvl('Île-de-France', 'region'),
            lvl('Paris', 'department'),
            lvl('Paris', 'nearest_city'),
        ];
        const root = buildPathHierarchy(
            [
                { levels: fr, value: 10 },
                { levels: fr, value: 5 },
            ],
            'All'
        );
        const country = root.children![0];
        expect(country.name).toBe('France');
        expect(country.filterKey).toBe('country');
        const dept = country.children![0].children![0];
        expect(dept.filterKey).toBe('department');
        const city = dept.children![0];
        expect(city.name).toBe('Paris');
        expect(city.filterKey).toBe('nearest_city');
        expect(city.value).toBe(15);
        expect(city.children).toBeUndefined(); // leaf
    });

    it('compacts skipped levels: a foreign point reaches its city without a department', () => {
        const root = buildPathHierarchy(
            [
                {
                    levels: [
                        lvl('Spain', 'country'),
                        lvl('Madrid', 'region'),
                        lvl('Madrid', 'nearest_city'),
                    ],
                    value: 20,
                },
            ],
            'All'
        );
        const region = root.children![0].children![0];
        expect(region.name).toBe('Madrid');
        expect(region.filterKey).toBe('region');
        const city = region.children![0];
        expect(city.name).toBe('Madrid');
        expect(city.filterKey).toBe('nearest_city'); // city shows, keyed correctly
        expect(city.value).toBe(20);
    });

    it('splits a node that is both a destination and a parent with a "—" leaf', () => {
        const base = [
            lvl('France', 'country'),
            lvl('Île-de-France', 'region'),
            lvl('Paris', 'department'),
        ];
        const root = buildPathHierarchy(
            [
                { levels: [...base, lvl('Paris', 'nearest_city')], value: 10 },
                { levels: base, value: 4 },
            ],
            'All'
        );
        const dept = root.children![0].children![0].children![0];
        expect(dept.name).toBe('Paris');
        expect(dept.value).toBeUndefined();
        const names = dept.children!.map((c) => c.name).sort();
        expect(names).toEqual(['Paris', '—']);
        expect(nodeTotal(dept)).toBe(14); // 10 (city) + 4 (placeholder)
    });

    /**
     * Google activity carries a link per entry, and the sunburst opens it from a
     * leaf — so the destination node has to keep it, wherever in the path it
     * lands (a search has no channel, so its leaf sits one ring shallower).
     */
    it('carries an optional href to the destination node', () => {
        const root = buildPathHierarchy(
            [
                {
                    levels: [lvl('YouTube', 'service'), lvl('watched', 'action')],
                    value: 1,
                    href: 'https://www.youtube.com/watch?v=abc',
                },
                { levels: [lvl('Search', 'service'), lvl('searched', 'action')], value: 1 },
            ],
            'All'
        );

        const [youtube, search] = root.children!;
        expect(youtube.children![0].href).toBe('https://www.youtube.com/watch?v=abc');
        expect(search.children![0].href).toBeUndefined();
    });

    it('keeps the first href when rows share a destination', () => {
        const levels = [lvl('YouTube', 'service'), lvl('watched', 'action')];
        const root = buildPathHierarchy(
            [
                { levels, value: 1, href: 'https://first' },
                { levels, value: 1, href: 'https://second' },
            ],
            'All'
        );

        const node = root.children![0].children![0];
        expect(node.href).toBe('https://first');
        expect(node.value).toBe(2);
    });

    /**
     * `name` is what the sunburst writes into the cross-filter, so it has to stay
     * the value the data carries. Prettifying it there silently breaks filtering:
     * the store ends up holding "YouTube" while the points carry "youtube", and
     * nothing ever matches. `label` is the display-only escape hatch.
     */
    it('keeps a display label apart from the filter value', () => {
        const root = buildPathHierarchy(
            [
                {
                    levels: [
                        { name: 'youtube', label: 'YouTube', key: 'service' },
                        lvl('watched', 'action'),
                    ],
                    value: 3,
                },
            ],
            'All'
        );

        const service = root.children![0];
        expect(service.name).toBe('youtube'); // what gets filtered on
        expect(service.label).toBe('YouTube'); // what gets shown
        // A level with no label falls back to its name at display time.
        expect(service.children![0].label).toBeUndefined();
    });

    it('skips rows with no levels', () => {
        const root = buildPathHierarchy(
            [
                { levels: [], value: 5 },
                { levels: [{ name: '', key: 'country' }], value: 3 },
            ],
            'All'
        );
        expect(root.children).toHaveLength(0);
    });
});

describe('nodeTotal', () => {
    it('sums leaf values recursively', () => {
        const root = buildSunburstHierarchy([
            { artist: 'A', album: 'X', track: 't1', minutes: 100, playCount: 1, trackUri: null },
            { artist: 'A', album: 'X', track: 't2', minutes: 50, playCount: 1, trackUri: null },
            { artist: 'B', album: 'Y', track: 't3', minutes: 30, playCount: 1, trackUri: null },
        ]);
        expect(nodeTotal(root)).toBe(180);
        expect(nodeTotal(root.children![0])).toBe(150);
    });
});

describe('bucketByDegree', () => {
    function leaf(name: string, value: number): SunburstNode {
        return { name, value, playCount: value };
    }

    it('folds children below ½/360 of their parent into an Other bucket', () => {
        // Parent total = 720 and the threshold is ½° → 720/360 × ½ = exactly 1.
        const tree: SunburstNode = {
            name: 'root',
            children: [
                { name: 'A', children: [leaf('a', 718)] },
                { name: 'B', children: [leaf('b', 1)] }, // 1 is not < 1 → kept
                { name: 'C', children: [leaf('c', 0.6)] }, // < 1 → folded
                { name: 'D', children: [leaf('d', 0.4)] }, // < 1 → folded
            ],
        };

        const bucketed = bucketByDegree(tree, 0);
        const names = bucketed.children!.map((c) => c.name);

        expect(names).toEqual(['A', 'B', 'Other artists']);
        const other = bucketed.children!.find((c) => c.name === 'Other artists')!;
        expect(other.isOther).toBe(true);
        expect(other.value).toBeCloseTo(1); // 0.6 + 0.4
        expect(other.playCount).toBeCloseTo(1);
        expect(other.children).toBeUndefined(); // leaf, not zoomable
    });

    it('uses a threshold relative to each parent (per displayed level)', () => {
        // Big's total = 720 → its album threshold (½°) is 720/360 × ½ = 1,
        // independent of the global total. The tiny album folds even though,
        // globally, it might be larger than another artist's whole catalogue.
        const tree: SunburstNode = {
            name: 'root',
            children: [
                {
                    name: 'Big',
                    children: [
                        { name: 'Hits', children: [leaf('h', 719.5)] },
                        { name: 'Rarity', children: [leaf('r', 0.5)] }, // < 720/360 × ½ = 1
                    ],
                },
                { name: 'Small', children: [{ name: 'OnlyAlbum', children: [leaf('s', 10)] }] },
            ],
        };

        const bucketed = bucketByDegree(tree, 0);
        const big = bucketed.children!.find((c) => c.name === 'Big')!;
        const bigChildren = big.children!.map((c) => c.name);
        expect(bigChildren).toContain('Hits');
        expect(bigChildren).toContain('Other albums');
        expect(bigChildren).not.toContain('Rarity');

        // 'Small' (total 10) survives at the artist level because the artist
        // threshold is root-total / 360 × ½ = 730 / 720 ≈ 1.01, and 10 > 1.01.
        expect(bucketed.children!.map((c) => c.name)).toContain('Small');
    });

    it('uses level-specific Other labels', () => {
        const make = (): SunburstNode => ({
            name: 'p',
            children: [
                { name: 'keep', children: [leaf('k', 720)] },
                { name: 'tiny', children: [leaf('t', 0.5)] },
            ],
        });
        expect(bucketByDegree(make(), 0).children!.some((c) => c.name === 'Other artists')).toBe(
            true
        );
        expect(bucketByDegree(make(), 1).children!.some((c) => c.name === 'Other albums')).toBe(
            true
        );
        expect(bucketByDegree(make(), 2).children!.some((c) => c.name === 'Other tracks')).toBe(
            true
        );
    });

    it('keeps everything when no child is below the threshold', () => {
        const tree: SunburstNode = {
            name: 'root',
            children: [
                { name: 'A', children: [leaf('a', 50)] },
                { name: 'B', children: [leaf('b', 50)] },
            ],
        };
        const bucketed = bucketByDegree(tree, 0);
        expect(bucketed.children!.map((c) => c.name)).toEqual(['A', 'B']);
        expect(bucketed.children!.some((c) => c.isOther)).toBe(false);
    });
});
