import { describe, expect, it } from 'vitest';
import { generateMyActivity } from './activity';
import { buildAgenda } from './agenda';
import { parseActivityEntry } from '#lib/data/sources/googleActivity/parser.ts';
import { moduleById } from '#lib/data/modules.ts';
import type { ActivityRow } from '#lib/types/googleActivity.ts';

/**
 * The Google activity sample, read by the Takeout parser like a real export,
 * and held to the life it was drawn from.
 */

const UNTIL = new Date('2026-06-30');
const agenda = buildAgenda({ until: UNTIL });
const entries = generateMyActivity({ until: UNTIL, agenda });
const rows = entries.map(parseActivityEntry);
const parsed = rows.filter((row): row is ActivityRow => row !== null);
const life = agenda.days;
const days = new Map(life.map((day) => [day.date, day]));

describe('the activity sample goes through the Takeout parser', () => {
    it('parses every entry, as many as a heavy user leaves', () => {
        expect(parsed.length).toBe(entries.length);
        expect(parsed.length).toBeGreaterThan(80_000);
    });

    it('fills YouTube, Search and Maps, with the verbs Takeout uses', () => {
        expect(new Set(parsed.map((r) => r.service))).toEqual(
            new Set(['youtube', 'search', 'maps'])
        );
        expect(new Set(parsed.map((r) => r.action))).toEqual(
            new Set(['watched', 'searched', 'directions'])
        );
    });

    it('keeps where it happened and what was mapped', () => {
        expect(parsed.filter((r) => r.lat !== null).length).toBeGreaterThan(10_000);
        expect(parsed.filter((r) => r.placeLat !== null).length).toBeGreaterThan(1_000);
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

    it('searches for the move before it happens', () => {
        const moved = life.find((day) => day.phase === 'B')!.date;
        const before = parsed.filter(
            (r) => r.date < moved && /moving boxes|change of address|van rental/.test(r.label)
        );
        expect(before.length).toBeGreaterThan(3);
    });

    it('watches running videos once the running has started', () => {
        const firstRun = life.find((day) => day.run !== 'none')!.date;
        const running = parsed.filter((r) => r.secondary === 'Run Easy');
        const early = running.filter((r) => r.date < firstRun);
        expect(running.length).toBeGreaterThan(100);
        expect(early.length / running.length).toBeLessThan(0.15);
    });

    it('watches more on a sick day than on an office day', () => {
        const watchedOn = (kind: string) => {
            const count = parsed.filter(
                (r) => r.action === 'watched' && days.get(r.date)?.kind === kind
            ).length;
            return count / life.filter((day) => day.kind === kind).length;
        };
        expect(watchedOn('sick')).toBeGreaterThan(watchedOn('work') * 2);
    });

    it('watches in the evening rather than at the office', () => {
        const office = parsed.filter((r) => days.get(r.date)?.kind === 'work');
        const hour = (r: ActivityRow) => Number(r.timestamp.slice(11, 13));
        const evening = office.filter((r) => r.action === 'watched' && hour(r) >= 19).length;
        const working = office.filter(
            (r) => r.action === 'watched' && hour(r) >= 10 && hour(r) < 17
        ).length;
        expect(evening).toBeGreaterThan(working * 3);
    });
});
