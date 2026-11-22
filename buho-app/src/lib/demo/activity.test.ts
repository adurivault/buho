import { describe, expect, it } from 'vitest';
import { generateMyActivity } from './activity';
import { lifeDays } from './life';
import { parseActivityEntry } from '#lib/data/sources/googleActivity/parser.ts';
import { moduleById } from '#lib/data/modules.ts';
import type { ActivityRow } from '#lib/types/googleActivity.ts';

/**
 * The Google activity sample, read by the Takeout parser like a real export,
 * and held to the life it was drawn from.
 */

const UNTIL = new Date('2026-06-30');
const entries = generateMyActivity({ until: UNTIL });
const rows = entries.map(parseActivityEntry);
const parsed = rows.filter((row): row is ActivityRow => row !== null);
const life = lifeDays({ until: UNTIL });
const days = new Map(life.map((day) => [day.date, day]));

describe('the activity sample goes through the Takeout parser', () => {
    it('parses every entry', () => {
        expect(parsed.length).toBe(entries.length);
        expect(parsed.length).toBeGreaterThan(10_000);
    });

    it('fills YouTube, Search and Maps, with the verbs Takeout uses', () => {
        expect(new Set(parsed.map((r) => r.service))).toEqual(
            new Set(['youtube', 'search', 'maps'])
        );
        expect(new Set(parsed.map((r) => r.action))).toEqual(new Set(['watched', 'searched']));
    });

    it('keeps where it happened and what was mapped', () => {
        expect(parsed.filter((r) => r.lat !== null).length).toBeGreaterThan(1_000);
        expect(parsed.filter((r) => r.placeLat !== null).length).toBeGreaterThan(100);
    });

    it('declares the module it fills', () => {
        expect(moduleById('activity').hasDemo).toBe(true);
    });
});

describe('the entries follow the life', () => {
    it('plans each trip before it starts', () => {
        const trips = [...new Set(life.map((day) => day.trip).filter((trip) => trip !== null))];
        const planned = trips.filter((trip) =>
            parsed.some(
                (r) =>
                    r.service === 'search' &&
                    r.date < trip!.from &&
                    r.label.includes(trip!.name.toLowerCase())
            )
        );
        expect(planned.length / trips.length).toBeGreaterThan(0.8);
    });

    it('watches running videos only once the running has started', () => {
        const firstRun = life.find((day) => day.run)!.date;
        const running = parsed.filter((r) => r.secondary === 'Run Easy');
        expect(running.length).toBeGreaterThan(0);
        expect(running.every((r) => r.date >= firstRun)).toBe(true);
    });

    it('watches more on a sick day than on a workday', () => {
        const watchedOn = (kind: string) => {
            const dates = life.filter((day) => day.kind === kind).map((day) => day.date);
            const count = parsed.filter(
                (r) => r.action === 'watched' && days.get(r.date)?.kind === kind
            ).length;
            return count / dates.length;
        };
        expect(watchedOn('sick')).toBeGreaterThan(watchedOn('work') * 2);
    });
});
