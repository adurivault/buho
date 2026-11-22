import { describe, expect, test } from 'vitest';
import { DATA_MODULES, moduleById, type ModuleId } from './modules';

describe('data modules', () => {
    test('moduleById finds every declared module', () => {
        for (const module of DATA_MODULES) {
            expect(moduleById(module.id)).toBe(module);
        }
    });

    test('moduleById throws on an id that does not exist', () => {
        // The section headers render `moduleById(...).label`; a typo has to fail
        // loudly rather than leave a page with a blank title.
        expect(() => moduleById('watching' as ModuleId)).toThrow(/Unknown module/);
    });

    test('a module names the dataset, not the service that recorded it', () => {
        // The sidebar may still say "Garmin" — that's where you'd look for it —
        // but the label is what the page header and the matrix column show.
        expect(moduleById('steps').label).toBe('Steps');
        expect(moduleById('positions').label).toBe('Positions');
        expect(moduleById('listening').label).toBe('Listening');
    });

    test('the glyphs stand for datasets, never for one service that feeds them', () => {
        // Two services feed Listening and two feed Positions, so neither column
        // may wear one contributor's mark.
        expect(moduleById('listening').icon).toBe('music-note');
        expect(moduleById('steps').icon).toBe('footprints');
    });
});
