import { describe, it, expect } from 'vitest';
import {
    buildSunburstHierarchy,
    bucketByDegree,
    nodeTotal,
    type SunburstNode
} from './sunburstHierarchy';
import type { ArtistSunburstRow } from '$lib/data/queries/artistQueries';

describe('buildSunburstHierarchy', () => {
    it('builds a full 3-level tree from flat rows', () => {
        const rows: ArtistSunburstRow[] = [
            { artist: 'Artist A', album: 'Album A', track: 'Song 1', minutes: 100, playCount: 30, trackUri: 'spotify:track:1' },
            { artist: 'Artist A', album: 'Album A', track: 'Song 2', minutes: 50, playCount: 15, trackUri: null },
            { artist: 'Artist A', album: 'Album B', track: 'Song 3', minutes: 40, playCount: 12, trackUri: null },
            { artist: 'Artist B', album: 'Album C', track: 'Song 4', minutes: 80, playCount: 25, trackUri: null }
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
            trackUri: 'spotify:track:1'
        });
    });

    it('does not merge identical album names across artists', () => {
        const rows: ArtistSunburstRow[] = [
            { artist: 'Artist A', album: 'Greatest Hits', track: 'Song 1', minutes: 10, playCount: 3, trackUri: null },
            { artist: 'Artist B', album: 'Greatest Hits', track: 'Song 2', minutes: 12, playCount: 4, trackUri: null }
        ];

        const root = buildSunburstHierarchy(rows);

        expect(root.children).toHaveLength(2);
        expect(root.children![0].children![0].name).toBe('Greatest Hits');
        expect(root.children![1].children![0].name).toBe('Greatest Hits');
        expect(root.children![0].children![0].children![0].name).toBe('Song 1');
        expect(root.children![1].children![0].children![0].name).toBe('Song 2');
    });
});

describe('nodeTotal', () => {
    it('sums leaf values recursively', () => {
        const root = buildSunburstHierarchy([
            { artist: 'A', album: 'X', track: 't1', minutes: 100, playCount: 1, trackUri: null },
            { artist: 'A', album: 'X', track: 't2', minutes: 50, playCount: 1, trackUri: null },
            { artist: 'B', album: 'Y', track: 't3', minutes: 30, playCount: 1, trackUri: null }
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
                { name: 'D', children: [leaf('d', 0.4)] } // < 1 → folded
            ]
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
                        { name: 'Rarity', children: [leaf('r', 0.5)] } // < 720/360 × ½ = 1
                    ]
                },
                { name: 'Small', children: [{ name: 'OnlyAlbum', children: [leaf('s', 10)] }] }
            ]
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
                { name: 'tiny', children: [leaf('t', 0.5)] }
            ]
        });
        expect(bucketByDegree(make(), 0).children!.some((c) => c.name === 'Other artists')).toBe(true);
        expect(bucketByDegree(make(), 1).children!.some((c) => c.name === 'Other albums')).toBe(true);
        expect(bucketByDegree(make(), 2).children!.some((c) => c.name === 'Other tracks')).toBe(true);
    });

    it('keeps everything when no child is below the threshold', () => {
        const tree: SunburstNode = {
            name: 'root',
            children: [
                { name: 'A', children: [leaf('a', 50)] },
                { name: 'B', children: [leaf('b', 50)] }
            ]
        };
        const bucketed = bucketByDegree(tree, 0);
        expect(bucketed.children!.map((c) => c.name)).toEqual(['A', 'B']);
        expect(bucketed.children!.some((c) => c.isOther)).toBe(false);
    });
});
