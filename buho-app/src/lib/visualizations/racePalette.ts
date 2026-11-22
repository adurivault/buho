import { themeStore } from '#lib/stores/themeStore.svelte.ts';

/**
 * The bar chart races' palette (artists, tracks…): seventeen hues in order
 * around the colour wheel, red → orange → … → violet → pink, stepped per theme.
 *
 * A race names every bar beside it, so the hue is only there to follow a bar as
 * it moves, not to tell seventeen categories apart; that is why it can run past
 * the eight validated categorical slots. On paper the bars take the -600 shades,
 * which stand out from the surface; on ink the -300 ones.
 */
const RACE_PALETTE_LIGHT = [
    '#dc2626', // red-600
    '#ea580c', // orange-600
    '#d97706', // amber-600
    '#ca8a04', // yellow-600
    '#65a30d', // lime-600
    '#16a34a', // green-600
    '#059669', // emerald-600
    '#0d9488', // teal-600
    '#0891b2', // cyan-600
    '#0284c7', // sky-600
    '#2563eb', // blue-600
    '#4f46e5', // indigo-600
    '#7c3aed', // violet-600
    '#9333ea', // purple-600
    '#c026d3', // fuchsia-600
    '#db2777', // pink-600
    '#e11d48', // rose-600
];

const RACE_PALETTE_DARK = [
    '#fca5a5', // red-300
    '#fdba74', // orange-300
    '#fcd34d', // amber-300
    '#fde047', // yellow-300
    '#bef264', // lime-300
    '#86efac', // green-300
    '#6ee7b7', // emerald-300
    '#5eead4', // teal-300
    '#67e8f9', // cyan-300
    '#7dd3fc', // sky-300
    '#93c5fd', // blue-300
    '#a5b4fc', // indigo-300
    '#c4b5fd', // violet-300
    '#d8b4fe', // purple-300
    '#f0abfc', // fuchsia-300
    '#f9a8d4', // pink-300
    '#fda4af', // rose-300
];

export const RACE_PALETTE_SIZE = RACE_PALETTE_LIGHT.length;

/** The race palette in the current theme; read it inside an effect to repaint on a toggle. */
export function racePalette(): string[] {
    return themeStore.theme === 'dark' ? RACE_PALETTE_DARK : RACE_PALETTE_LIGHT;
}
