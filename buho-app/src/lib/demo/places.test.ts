import { describe, expect, it } from 'vitest';
import { generateTimeline } from './places';
import { HOME, lifeDays } from './life';
import { parseTimelineData } from '#lib/data/sources/googleTimeline/parse.ts';
import { haversineMeters } from '#lib/data/geo/haversine.ts';
import { moduleById } from '#lib/data/modules.ts';

/**
 * The location sample, read by the Timeline parser like a real export, and
 * held to the life it was drawn from.
 */

const UNTIL = new Date('2026-06-30');
const entries = generateTimeline({ until: UNTIL });
const segments = parseTimelineData(entries);
const days = new Map(lifeDays({ until: UNTIL }).map((day) => [day.date, day]));

const stays = segments.filter((s) => s.segmentType === 'stationary');
const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
    haversineMeters(a, b) / 1000;

describe('the location sample goes through the Timeline parser', () => {
    it('yields both stays and moves, every day of three years', () => {
        expect(stays.length).toBeGreaterThan(3_000);
        expect(segments.some((s) => s.segmentType === 'moving')).toBe(true);
        expect(new Set(segments.map((s) => s.date)).size).toBeGreaterThan(1_090);
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

    it('declares the module it fills', () => {
        expect(moduleById('positions').hasDemo).toBe(true);
    });
});

describe('the places follow the life', () => {
    it('spends the workday at the office and the night at home', () => {
        const work = stays.filter((s) => days.get(s.date)?.kind === 'work');
        expect(work.some((s) => s.semanticType === 'Work')).toBe(true);
        const nights = work.filter((s) => s.timestamp.slice(11, 13) === '00');
        const atHome = nights.filter((s) => s.semanticType === 'Home');
        expect(atHome.length / nights.length).toBeGreaterThan(0.9);
    });

    it('goes where the holidays go', () => {
        const away = stays.filter((s) => {
            const day = days.get(s.date);
            return day?.kind === 'holiday' && day.trip && day.date !== day.trip.from;
        });
        const near = away.filter((s) => {
            const trip = days.get(s.date)!.trip!;
            return km(s, trip) < 10;
        });
        expect(near.length / away.length).toBeGreaterThan(0.8);
    });

    it('stays in town otherwise', () => {
        const ordinary = stays.filter((s) => days.get(s.date)?.kind === 'work');
        expect(ordinary.every((s) => km(s, HOME) < 15)).toBe(true);
    });
});
