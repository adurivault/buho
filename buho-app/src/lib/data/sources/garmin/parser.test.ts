import { describe, expect, it } from 'vitest';
import { garminFitParser } from './parser';
import { googleTimelineParser } from '../googleTimeline/parser';
import { readDrop, routeEntries } from '../registry';
import type { ImportEntry } from '../types';

/** A binary entry, standing in for a `.fit` member of a Garmin export. */
function fitEntry(path: string, bytes: Uint8Array = new Uint8Array([0, 0, 0, 0])): ImportEntry {
    return {
        path,
        name: path.split('/').pop() ?? path,
        binary: true,
        peek: async () => {
            throw new Error('a binary entry must never be peeked');
        },
        text: async () => {
            throw new Error('a binary entry must never be read as text');
        },
        bytes: async () => bytes,
    };
}

function textEntry(path: string, content: string): ImportEntry {
    return {
        path,
        name: path.split('/').pop() ?? path,
        peek: async (length) => content.slice(0, length),
        text: async () => content,
        bytes: async () => new TextEncoder().encode(content),
    };
}

/** A Timeline export as the phone ships it: a bare array of entries. */
const TIMELINE = JSON.stringify([
    {
        startTime: '2024-06-01T08:00:00.000+02:00',
        endTime: '2024-06-01T09:00:00.000+02:00',
        visit: {
            topCandidate: {
                placeLocation: 'geo:48.8566,2.3522',
                placeID: 'ChIJD7fiBh9u5kcR',
                semanticType: 'Home',
            },
        },
    },
]);

/** What a Garmin export ships alongside the `.fit` files, and we ignore. */
const UDS_DAILY = JSON.stringify([
    { userProfilePK: 1, calendarDate: '2026-04-22', totalSteps: 777, dailyStepGoal: 6490 },
]);

describe('garminFitParser', () => {
    it('claims the export’s .fit files', async () => {
        const { matched, unmatched } = await routeEntries([
            fitEntry('DI_CONNECT/UploadedFiles_0-_Part1.zip/jules.marin_123.fit'),
            fitEntry('DI_CONNECT/UploadedFiles_0-_Part1.zip/jules.marin_456.fit'),
        ]);

        expect([...matched.keys()].map((p) => p.id)).toEqual(['garmin']);
        expect([...matched.values()][0]).toHaveLength(2);
        expect(unmatched).toHaveLength(0);
    });

    /**
     * The daily totals and performance indices next to the `.fit` files are
     * exactly what reading the raw files is meant to avoid, so nothing should
     * quietly start importing them.
     */
    it('leaves the export’s roll-up JSON to no one', async () => {
        const { matched, unmatched } = await routeEntries([
            textEntry(
                'DI_CONNECT/DI-Connect-Aggregator/UDSFile_2026-04-22_2026-07-31.json',
                UDS_DAILY
            ),
        ]);

        expect(matched.size).toBe(0);
        expect(unmatched.map((e) => e.name)).toEqual(['UDSFile_2026-04-22_2026-07-31.json']);
    });

    it('claims nothing outside its own format', () => {
        expect(
            garminFitParser.match(textEntry('Takeout/location-history.json', TIMELINE), TIMELINE)
        ).toBe(0);
        expect(garminFitParser.match(fitEntry('photos/run.jpg'), '')).toBe(0);
    });

    it('survives a file it cannot decode', async () => {
        const { positions, steps } = await readDrop([
            fitEntry('UploadedFiles/damaged.fit', new Uint8Array([1, 2, 3])),
        ]);

        expect(positions).toEqual([]);
        expect(steps).toEqual([]);
    });
});

describe('googleTimelineParser', () => {
    it('claims a location history on its shape', async () => {
        const { matched } = await routeEntries([
            textEntry('Takeout/location-history.json', TIMELINE),
        ]);

        expect([...matched.keys()].map((p) => p.id)).toEqual(['google-timeline']);
    });

    it('needs the shape, not just a promising name', () => {
        const settings = '{"theme":"dark"}';
        expect(
            googleTimelineParser.match(textEntry('Timeline/settings.json', settings), settings)
        ).toBe(0);
    });

    it('reads the Takeout wrapper as well as the phone export', async () => {
        const wrapped = JSON.stringify({ semanticSegments: JSON.parse(TIMELINE) });
        const { positions } = await readDrop([textEntry('Takeout/Timeline.json', wrapped)]);

        expect(positions).toHaveLength(1);
        expect(positions[0].source).toBe('google-timeline');
        expect(positions[0].semanticType).toBe('Home');
    });

    it('skips a damaged file instead of losing the export', async () => {
        const { positions } = await readDrop([
            textEntry('Takeout/location-history.json', '{ truncated'),
            textEntry('Takeout/location-history-2.json', TIMELINE),
        ]);

        expect(positions).toHaveLength(1);
    });
});

describe('an export the size of a real one', () => {
    /**
     * Real regression: `readDrop` collected each parser's output with
     * `push(...rows)`, which passes every row as a call argument. A Garmin export
     * yields ~300k track points in one parse, so the import died on a stack
     * overflow — and the same call sat on the Google-activity path.
     */
    it('collects a parse far larger than an engine takes arguments', async () => {
        const many = 300_000;
        const timeline = JSON.stringify(
            Array.from({ length: many }, (_, i) => ({
                startTime: '2024-06-01T08:00:00.000+02:00',
                endTime: '2024-06-01T08:01:00.000+02:00',
                timelinePath: [
                    {
                        point: `geo:48.${800000 + i},2.3522`,
                        durationMinutesOffsetFromStartTime: '0',
                    },
                ],
            }))
        );

        const { positions } = await readDrop([
            textEntry('Takeout/location-history.json', timeline),
        ]);

        expect(positions).toHaveLength(many);
    });
});

describe('one drop, several providers', () => {
    /**
     * Both providers feed the positions table, so a folder holding a Timeline
     * export next to a Garmin one has to yield both rather than pick a winner.
     */
    it('routes a Timeline export and a Garmin export to their own parsers', async () => {
        const { matched } = await routeEntries([
            textEntry('Takeout/location-history.json', TIMELINE),
            fitEntry('garmin/UploadedFiles/jules.marin_123.fit'),
        ]);

        expect([...matched.keys()].map((p) => p.id).sort()).toEqual(['garmin', 'google-timeline']);
    });
});
