import { ACTIVITY_KINDS, ACTIVITY_OTHER } from '#lib/data/queries/positionsQueries.ts';

/**
 * The categorical colours the relative-day traces are painted with, whichever
 * question they are answering — what you were doing, or where you set off from.
 *
 * Chosen against both themes at once rather than per mode: the traces are drawn
 * on a canvas the theme paints behind, and one palette that clears the tighter
 * of the two lightness bands (OKLCH L 0.48–0.67, the dark one) is worth more
 * than two sets that have to be kept in step. Every hue clears the chroma floor
 * and 3:1 against the dark surface, and the worst normal-vision pair is ΔE 15.4.
 *
 * Six categories cannot be made colourblind-safe at the ΔE ≥ 8 target — the
 * worst pair here is 7.0 under deuteranopia, inside the floor band that is only
 * legal alongside a second channel. That channel is the legend: clicking an
 * entry isolates it, which answers "which of these two is which" exactly,
 * rather than asking anyone to tell an olive from a red at 10% alpha.
 */
export const CATEGORY_PALETTE: string[] = [
    '#407E38',
    '#A98D14',
    '#23A5A2',
    '#DA2320',
    '#AE49B4',
    '#677EE5',
];

/**
 * The seventh slot, for whatever did not make the cut: unlabelled activity,
 * days that started somewhere that is not one of the usual places. A warm
 * neutral rather than a hue, so a catch-all never reads as a category.
 */
export const NEUTRAL = '#8C837A';

const toRgb = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
];

/**
 * Colour for slot `i` of `count` categories: the fixed hues in order, with the
 * last slot going neutral when it is standing in for the tail.
 */
export function categoryColor(i: number, count: number, tailIsOther = true): string {
    if (tailIsOther && i === count - 1) return NEUTRAL;
    return CATEGORY_PALETTE[i % CATEGORY_PALETTE.length];
}

export const categoryRgb = (
    i: number,
    count: number,
    tailIsOther = true
): [number, number, number] => toRgb(categoryColor(i, count, tailIsOther));

/** The activity buckets, indexed by their {@link ACTIVITY_KINDS} code. */
export const ACTIVITY_PALETTE: string[] = [
    ...CATEGORY_PALETTE,
    NEUTRAL, // Other
];

export const ACTIVITY_RGB: Array<[number, number, number]> = ACTIVITY_PALETTE.map(toRgb);

export const activityLabel = (kind: number): string =>
    ACTIVITY_KINDS[kind] ?? ACTIVITY_KINDS[ACTIVITY_OTHER];
