import { describe, it, expect } from 'vitest';
import { fixtureEntries } from '../fixtures.testutil';
import type { ImportEntry } from '../types';
import { appleHealthParser } from './parser';
import { createScanner, forEachLine, parseAppleDate, rowsFromScan } from './records';

const IPHONE =
    'device="&lt;&lt;HKDevice: 0x1&gt;, name:iPhone, manufacturer:Apple Inc., model:iPhone, hardware:iPhone14,5, software:17.2&gt;"';
const WATCH =
    'device="&lt;&lt;HKDevice: 0x2&gt;, name:Apple Watch, manufacturer:Apple Inc., model:Watch, hardware:Watch6,1, software:10.2&gt;"';

const record = (
    type: string,
    device: string,
    unit: string,
    start: string,
    end: string,
    value: number
) =>
    ` <Record type="HKQuantityTypeIdentifier${type}" sourceName="Test" ${device} unit="${unit}" creationDate="${end}" startDate="${start}" endDate="${end}" value="${value}"/>`;

/** Rows from a handful of record lines, read in UTC unless markers say otherwise. */
function rowsOf(lines: string[], zone = 'UTC') {
    const scanner = createScanner();
    for (const line of lines) scanner.line(line);
    return rowsFromScan(scanner.result(), zone);
}

describe('the fixture export', async () => {
    const { steps, gait } = await appleHealthParser.parse(fixtureEntries('appleHealth'), {
        paths: [],
        hasPathSegment: () => false,
    });

    it("keeps only the phone's own step counts", () => {
        // The copy Garmin Connect wrote into Health has no device and is skipped.
        expect(steps.map((p) => p.steps)).toEqual([812, 1034, 640]);
        expect(steps.every((p) => p.source === 'apple-health')).toBe(true);
    });

    it('puts a winter morning back in winter time', () => {
        // Written as 09:00 +0200, the offset of the summer it was exported in.
        expect(steps[0]).toMatchObject({
            startTimestamp: '2024-01-15 08:00:00',
            timestamp: '2024-01-15 08:08:00',
            date: '2024-01-15',
            spanSeconds: 480,
        });
    });

    it("reads a trip in the zone the phone's bedtimes name", () => {
        expect(steps[2]).toMatchObject({
            startTimestamp: '2024-03-11 08:00:00',
            timestamp: '2024-03-11 08:09:30',
        });
    });

    it('pairs each window with the distance counted over it', () => {
        expect(steps[0].distanceMeters).toBeCloseTo(610);
        expect(steps[2].distanceMeters).toBeNull();
    });

    it('leaves what the phone never measures unknown rather than zero', () => {
        expect(steps[0]).toMatchObject({
            activeSeconds: null,
            cadenceSpm: null,
            runningSteps: null,
            calories: null,
        });
    });

    it('reads the gait readings in the units Buho shows them in', () => {
        const january = gait.filter((r) => r.date === '2024-01-15');
        expect(Object.fromEntries(january.map((r) => [r.metric, r.value]))).toEqual({
            walking_speed: 4.68,
            step_length: 71,
            double_support: expect.closeTo(26.4),
            walking_asymmetry: 2,
        });
        expect(january[0].timestamp).toBe('2024-01-15 08:02:00');
    });
});

describe('records', () => {
    it('converts imperial units', () => {
        const { steps, gait } = rowsOf([
            record(
                'StepCount',
                IPHONE,
                'count',
                '2024-05-01 10:00:00 +0000',
                '2024-05-01 10:05:00 +0000',
                500
            ),
            record(
                'DistanceWalkingRunning',
                IPHONE,
                'mi',
                '2024-05-01 10:00:00 +0000',
                '2024-05-01 10:05:00 +0000',
                0.25
            ),
            record(
                'WalkingSpeed',
                IPHONE,
                'mi/hr',
                '2024-05-01 10:01:00 +0000',
                '2024-05-01 10:02:00 +0000',
                3
            ),
            record(
                'WalkingStepLength',
                IPHONE,
                'in',
                '2024-05-01 10:01:00 +0000',
                '2024-05-01 10:02:00 +0000',
                28
            ),
        ]);
        expect(steps[0].distanceMeters).toBeCloseTo(402.336);
        expect(gait.find((r) => r.metric === 'walking_speed')?.value).toBeCloseTo(4.828);
        expect(gait.find((r) => r.metric === 'step_length')?.value).toBeCloseTo(71.12);
    });

    it('gives the watch every hour it recorded, and the phone the rest', () => {
        const { steps } = rowsOf([
            // 10:00 — both counted the walk, the phone a little more: still the watch's.
            record(
                'StepCount',
                WATCH,
                'count',
                '2024-05-01 10:00:00 +0000',
                '2024-05-01 10:10:00 +0000',
                900
            ),
            record(
                'StepCount',
                IPHONE,
                'count',
                '2024-05-01 10:00:00 +0000',
                '2024-05-01 10:10:00 +0000',
                980
            ),
            // 11:00 — the watch on its charger.
            record(
                'StepCount',
                IPHONE,
                'count',
                '2024-05-01 11:00:00 +0000',
                '2024-05-01 11:10:00 +0000',
                700
            ),
        ]);
        expect(steps.map((p) => p.steps)).toEqual([900, 700]);
    });

    it('skips a unit it cannot convert', () => {
        const { gait } = rowsOf([
            record(
                'WalkingSpeed',
                IPHONE,
                'furlong/fortnight',
                '2024-05-01 10:01:00 +0000',
                '2024-05-01 10:02:00 +0000',
                3
            ),
        ]);
        expect(gait).toEqual([]);
    });
});

describe('parseAppleDate', () => {
    it('applies the written offset', () => {
        expect(parseAppleDate('2024-01-15 09:00:00 +0200')).toBe(
            Date.parse('2024-01-15T07:00:00Z')
        );
        expect(parseAppleDate('2024-01-15 09:00:00 -0500')).toBe(
            Date.parse('2024-01-15T14:00:00Z')
        );
    });

    it('returns NaN on anything else', () => {
        expect(parseAppleDate('2024-01-15T09:00:00Z')).toBeNaN();
    });
});

describe('forEachLine', () => {
    it('splits lines across slices, multi-byte characters included', async () => {
        const text = 'première ligne\nsecond — line\n\nlast';
        const lines: string[] = [];
        await forEachLine(new TextEncoder().encode(text), (line) => lines.push(line), 3);
        expect(lines).toEqual(['première ligne', 'second — line', '', 'last']);
    });
});

describe('appleHealthParser', () => {
    const entry = (name: string, content: string): ImportEntry => ({
        path: `apple_health_export/${name}`,
        name,
        binary: true,
        peek: async (length) => content.slice(0, length),
        text: async () => content,
        bytes: async () => new TextEncoder().encode(content),
    });

    it('claims export.xml and nothing else', () => {
        expect(appleHealthParser.match(entry('export.xml', ''), '')).toBe(1);
        expect(appleHealthParser.match(entry('export_cda.xml', ''), '')).toBe(0);
    });

    it("reads nothing from another export's file of the same name", async () => {
        const payload = await appleHealthParser.parse(
            [entry('export.xml', '<?xml version="1.0"?>\n<Export/>')],
            {
                paths: [],
                hasPathSegment: () => false,
            }
        );
        expect(payload).toEqual({ positions: [], steps: [], gait: [], health: [] });
    });
});
