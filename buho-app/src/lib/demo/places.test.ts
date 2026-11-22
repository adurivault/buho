import { describe, expect, it } from 'vitest';
import { generateTimeline } from './places';
import { buildAgenda } from './agenda';
import { parseTimelineData } from '#lib/data/sources/googleTimeline/parse.ts';
import { haversineMeters } from '#lib/data/geo/haversine.ts';
import { moduleById } from '#lib/data/modules.ts';

/**
 * The location sample, read by the Timeline parser like a real export, and
 * held to the life it was drawn from.
 */

const UNTIL = new Date('2026-06-30');
const agenda = buildAgenda({ until: UNTIL });
const entries = generateTimeline({ until: UNTIL, agenda });
const segments = parseTimelineData(entries);
const days = new Map(agenda.days.map((day) => [day.date, day]));

const stays = segments.filter((s) => s.segmentType === 'stationary');
const moving = segments.filter((s) => s.segmentType === 'moving');
const PARIS = { lat: 48.8566, lon: 2.3522 };
const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
    haversineMeters(a, b) / 1000;

describe('the location sample goes through the Timeline parser', () => {
    it('yields stays and moves, nearly every day of four years', () => {
        expect(stays.length).toBeGreaterThan(5_000);
        expect(moving.length).toBeGreaterThan(30_000);
        expect(new Set(segments.map((s) => s.date)).size).toBeGreaterThan(1_400);
    });

    it('never has two stays at once', () => {
        const ordered = entries
            .filter((e) => 'visit' in e)
            .map((e) => e as { startTime: string; endTime: string })
            .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
        for (let i = 1; i < ordered.length; i += 1) {
            expect(Date.parse(ordered[i].startTime)).toBeGreaterThanOrEqual(
                Date.parse(ordered[i - 1].endTime)
            );
        }
    });

    /** A night at home is one visit across midnight, not two cut at it. */
    it('does not cut the night at midnight', () => {
        const atMidnight = stays.filter((s) => s.timestamp.slice(11, 16) === '00:00');
        expect(atMidnight.length).toBeLessThan(days.size * 0.05);
    });

    it('declares the module it fills', () => {
        expect(moduleById('positions').hasDemo).toBe(true);
    });
});

describe('the journeys are drawn along the way', () => {
    /** Consecutive points of a journey are close: a path, not a jump. */
    it('samples a journey in town densely', () => {
        const gaps: number[] = [];
        for (let i = 1; i < moving.length; i += 1) {
            const a = moving[i - 1];
            const b = moving[i];
            if (km(a, PARIS) < 8 && km(b, PARIS) < 8 && a.endTimestamp === b.timestamp) {
                gaps.push(km(a, b) * 1000);
            }
        }
        gaps.sort((x, y) => x - y);
        expect(gaps.length).toBeGreaterThan(10_000);
        expect(gaps[Math.floor(gaps.length / 2)]).toBeLessThan(150);
    });

    /** Trains and motorways bend; only a plane flies straight. */
    it('never jumps across the country in one stride', () => {
        let longest = 0;
        for (let i = 1; i < moving.length; i += 1) {
            const a = moving[i - 1];
            const b = moving[i];
            if (a.endTimestamp === b.timestamp) longest = Math.max(longest, km(a, b));
        }
        expect(longest).toBeLessThan(60);
    });
});

describe('the places follow the life', () => {
    it('spends office days at the office', () => {
        const work = stays.filter((s) => days.get(s.date)?.kind === 'work');
        const atWork = work.filter((s) => s.semanticType === 'Work');
        expect(atWork.length).toBeGreaterThan(days.size * 0.2);
    });

    it('sleeps at home on an ordinary night', () => {
        const ordinary = [...days.values()].filter(
            (d) => !d.trip && !d.late && !d.untracked && d.kind !== 'sick'
        );
        let home = 0;
        let counted = 0;
        for (const day of ordinary) {
            const night = `${day.date} 04:00:00`;
            const stay = stays.find((s) => s.timestamp <= night && s.endTimestamp >= night);
            if (!stay) continue;
            counted += 1;
            if (stay.semanticType === 'Home') home += 1;
        }
        expect(counted).toBeGreaterThan(ordinary.length * 0.8);
        expect(home / counted).toBeGreaterThan(0.95);
    });

    it('moves house halfway through', () => {
        const homes = new Set(stays.filter((s) => s.semanticType === 'Home').map((s) => s.placeId));
        expect(homes.size).toBe(2);
    });

    it('goes where the holidays go', () => {
        const away = stays.filter((s) => {
            const day = days.get(s.date);
            return day?.trip && day.date !== day.trip.from && day.date !== day.trip.to;
        });
        const there = away.filter((s) => km(s, days.get(s.date)!.trip!) < 15);
        expect(there.length / away.length).toBeGreaterThan(0.85);
    });
});
