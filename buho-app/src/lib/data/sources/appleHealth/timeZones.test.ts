import { describe, it, expect } from 'vitest';
import { buildZoneTimeline, offsetMinutesAt } from './timeZones';

const at = (iso: string) => Date.parse(iso);

describe('offsetMinutesAt', () => {
    it('follows daylight saving', () => {
        expect(offsetMinutesAt('Europe/Paris', at('2024-01-15T07:00:00Z'))).toBe(60);
        expect(offsetMinutesAt('Europe/Paris', at('2024-07-15T07:00:00Z'))).toBe(120);
    });

    it('switches on the hour of the change', () => {
        // Paris springs forward at 01:00 UTC on the last Sunday of March.
        expect(offsetMinutesAt('Europe/Paris', at('2024-03-31T00:59:59Z'))).toBe(60);
        expect(offsetMinutesAt('Europe/Paris', at('2024-03-31T01:00:00Z'))).toBe(120);
    });

    it('reads west of Greenwich as negative', () => {
        expect(offsetMinutesAt('America/Lima', at('2024-03-11T13:00:00Z'))).toBe(-300);
    });

    it('reads a zone the engine does not know as UTC', () => {
        expect(offsetMinutesAt('Nowhere/Atlantis', at('2024-01-01T00:00:00Z'))).toBe(0);
    });
});

describe('buildZoneTimeline', () => {
    const DAY = 24 * 3600_000;
    const paris1 = { ms: at('2024-01-01T22:00:00Z'), zone: 'Europe/Paris' };
    const paris2 = { ms: at('2024-01-20T22:00:00Z'), zone: 'Europe/Paris' };
    const lima = { ms: at('2024-02-10T04:00:00Z'), zone: 'America/Lima' };

    it('fills a gap between two markers that agree, however long', () => {
        const timeline = buildZoneTimeline([paris1, paris2], 'UTC');
        expect(timeline.zoneAt(paris1.ms + 10 * DAY)).toBe('Europe/Paris');
    });

    it('trusts the nearer marker for a day and a half when the zone changes', () => {
        const timeline = buildZoneTimeline([paris1, paris2, lima], 'UTC');
        expect(timeline.zoneAt(paris2.ms + DAY)).toBe('Europe/Paris');
        expect(timeline.zoneAt(lima.ms - DAY)).toBe('America/Lima');
    });

    it('falls back to the zone the markers name most when none is near', () => {
        const timeline = buildZoneTimeline([paris1, paris2, lima], 'UTC');
        expect(timeline.home).toBe('Europe/Paris');
        expect(timeline.zoneAt(paris2.ms + 10 * DAY)).toBe('Europe/Paris');
        expect(timeline.zoneAt(lima.ms + 30 * DAY)).toBe('Europe/Paris');
    });

    it("falls back to the reader's zone without any marker", () => {
        const timeline = buildZoneTimeline([], 'Asia/Tokyo');
        expect(timeline.zoneAt(paris1.ms)).toBe('Asia/Tokyo');
    });

    it('ignores markers naming a zone the engine does not know', () => {
        const timeline = buildZoneTimeline(
            [paris1, { ms: paris1.ms + DAY, zone: 'Nowhere/Atlantis' }],
            'UTC'
        );
        expect(timeline.zoneAt(paris1.ms + DAY)).toBe('Europe/Paris');
    });
});
