import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_MODULES } from '#lib/data/modules.ts';
import { CALENDAR_SHOTS, MODULE_SHOTS, shotSrc, tileShot, type Shot } from './shots';

const STATIC = join(__dirname, '../../static');

const every: Shot[] = [
    ...Object.values(MODULE_SHOTS).flatMap(({ main, side }) => [main, side]),
    CALENDAR_SHOTS.main,
    CALENDAR_SHOTS.side,
];

describe('the explorer captures', () => {
    /** They are committed files: `npm run shots` writes each in both themes. */
    it('exist for every capture a page shows, in both themes', () => {
        for (const shot of every) {
            for (const theme of ['light', 'dark'] as const) {
                const file = join(STATIC, 'shots', `${shot.file}-${theme}.webp`);
                expect(existsSync(file), `${shot.file}-${theme}.webp`).toBe(true);
            }
        }
    });

    /** Two of a kind would undo the point of showing two. */
    it('give every module a pair of different charts', () => {
        for (const module of DATA_MODULES) {
            const { main, side } = MODULE_SHOTS[module.id];
            expect(main.file).not.toBe(side.file);
            expect([main, side]).toContain(tileShot(module.id));
        }
    });

    it('serves each theme from its own file', () => {
        const shot = MODULE_SHOTS.positions.side;
        expect(shotSrc(shot, 'light')).toMatch(/shots\/positions-map-light\.webp$/);
        expect(shotSrc(shot, 'dark')).toMatch(/shots\/positions-map-dark\.webp$/);
        expect(shot.credit?.full).toMatch(/OpenFreeMap © OpenMapTiles.*OpenStreetMap contributors/);
    });
});
