import { afterEach, describe, expect, it } from 'vitest';
import { setTheme } from '#lib/stores/themeStore.svelte.ts';
import {
    CATEGORICAL_DARK,
    CATEGORICAL_LIGHT,
    participantColor,
    receivedColor,
    stickyColor,
    termColor,
} from './dimensionColors';

afterEach(() => setTheme('light'));

describe('stickyColor', () => {
    it('keeps a value on the same colour, whatever else is seen first', () => {
        const ios = stickyColor('test-platform', 'iOS');
        stickyColor('test-platform', 'Android');
        expect(stickyColor('test-platform', 'iOS')).toBe(ios);
    });

    // What is stored is the slot, so a toggle repaints without reassigning.
    it('follows the theme without moving the value to another slot', () => {
        setTheme('light');
        const light = stickyColor('test-theme', 'Web');
        const slot = CATEGORICAL_LIGHT.indexOf(light);

        setTheme('dark');
        expect(stickyColor('test-theme', 'Web')).toBe(CATEGORICAL_DARK[slot]);
    });

    it('paints "Other" in the neutral, never in a category', () => {
        const other = stickyColor('test-other', 'Other');
        expect(CATEGORICAL_LIGHT).not.toContain(other);
    });

    it('pins the two sides of a conversation', () => {
        setTheme('dark');
        expect(stickyColor('direction', 'Received')).toBe(receivedColor());
    });
});

describe('termColor', () => {
    it('gives the first three terms three different hues', () => {
        const first = [termColor(0), termColor(1), termColor(2)];
        expect(new Set(first).size).toBe(3);
    });

    it('cycles after the eighth term', () => {
        expect(termColor(8)).toBe(termColor(0));
    });
});

describe('participantColor', () => {
    // The blue is "you", right next to them on the same bar.
    it('never hands out the blue', () => {
        const blue = CATEGORICAL_LIGHT[0];
        for (let i = 0; i < 20; i++) {
            expect(participantColor(`person-${i}`)).not.toBe(blue);
        }
    });
});
