// Shared colors for the Explorer's dimensions (pies, constellation, barcharts).
// A given value (e.g. "iOS") always keeps the same color, regardless of its rank.
// The registry is shared across components and scoped by dimension (filterKey), so
// the "platform" pie, the constellation points, and the stacked barcharts match to
// the pixel.
import { themeStore } from '#lib/stores/themeStore.svelte.ts';
import { peakColor, themeHex } from '#lib/visualizations/themeColors.ts';

/**
 * The eight categorical hues, one set per theme: the sunburst's branch palette,
 * the only one validated against both chart surfaces (lightness band, chroma
 * floor, adjacent colour-blind separation). The dark values are stepped for the
 * dark surface, not the light ones reused.
 *
 * What is stored is a value's *slot*, never its colour, so a theme toggle
 * repaints every chart without anything being reassigned. The helpers below
 * read the theme, so a chart that calls them inside a `$derived` or an effect
 * redraws on its own.
 *
 * Slots 2–5 fall under 3:1 on the light surface; the marks drawn in them carry
 * a direct label or a tooltip.
 */
export const CATEGORICAL_LIGHT = [
    '#2a78d6', // blue
    '#eb6834', // orange
    '#1baf7a', // aqua
    '#eda100', // yellow
    '#e87ba4', // magenta
    '#008300', // green
    '#4a3aa7', // violet
    '#e34948', // red
];

export const CATEGORICAL_DARK = [
    '#3987e5',
    '#d95926',
    '#199e70',
    '#c98500',
    '#d55181',
    '#008300',
    '#9085e9',
    '#e66767',
];

/** "Other" and every catch-all: a neutral, so a remainder never reads as a category. */
const OTHER_LIGHT = '#9d9d9d';
const OTHER_DARK = '#4a443d';

const isDark = () => themeStore.theme === 'dark';

/** The colour of a slot in the current theme. */
export function categoricalColor(slot: number): string {
    const palette = isDark() ? CATEGORICAL_DARK : CATEGORICAL_LIGHT;
    return palette[slot % palette.length];
}

export function otherColor(): string {
    return isDark() ? OTHER_DARK : OTHER_LIGHT;
}

/**
 * The two sides of a conversation, resolved for the current theme — for the
 * canvas charts. "You" in the messages peak, "them" in a neutral
 * (`--them`, the strong border): the charts are about you, and everyone else
 * recedes. The two differ in lightness as well as hue, so the split survives a
 * bar a few pixels wide. SVG charts take {@link SENT_COLOR} / {@link RECEIVED_COLOR}.
 */
export function sentColor(): string {
    return peakColor('messages');
}

export function receivedColor(): string {
    // Read through the theme so a toggle repaints; the dependency is what makes
    // a `$derived` that calls this re-run.
    void isDark();
    return themeHex('--border-strong', '#8a8a8a');
}

/** The same pair as CSS, for SVG: it follows the theme without a redraw. */
export const SENT_COLOR = 'var(--peak-messages)';
export const RECEIVED_COLOR = 'var(--them)';

/**
 * One slot per search term, by position in the query rather than sticky by
 * value: a term is re-typed a letter at a time, and a sticky registry would
 * spend a colour on every prefix on the way. Ordered so the first three — most
 * searches have two or three — are as far apart as the palette allows, opening
 * on aqua, which no module accent is near.
 */
const TERM_SLOTS = [2, 1, 6, 0, 7, 3, 5, 4];

export function termColor(index: number): string {
    return categoricalColor(TERM_SLOTS[index % TERM_SLOTS.length]);
}

/**
 * One hue per person in a group thread. The blue slot is left out: it sits
 * right next to "you", which is the messages blue, on the same bar.
 */
const PARTICIPANT_SLOTS = [2, 1, 6, 4, 7, 3, 5];

const slots = new Map<string, Map<string, number>>();
const presets = new Map<string, Map<string, () => string>>();

function slotFor(key: string, value: string, palette: number[]): number {
    let dimSlots = slots.get(key);
    if (!dimSlots) {
        dimSlots = new Map();
        slots.set(key, dimSlots);
    }
    let slot = dimSlots.get(value);
    if (slot === undefined) {
        slot = palette[dimSlots.size % palette.length];
        dimSlots.set(value, slot);
    }
    return slot;
}

const ALL_SLOTS = CATEGORICAL_LIGHT.map((_, slot) => slot);

export function stickyColor(key: string, value: string): string {
    if (value === 'Other') return otherColor();
    const preset = presets.get(key)?.get(value);
    if (preset) return preset();
    return categoricalColor(slotFor(key, value, ALL_SLOTS));
}

/** Sticky across threads, so someone keeps their hue from one group to the next. */
export function participantColor(sender: string): string {
    return categoricalColor(slotFor('participant', sender, PARTICIPANT_SLOTS));
}

/** Pins a value's color instead of letting first-seen order pick it. */
export function presetColor(key: string, value: string, color: () => string): void {
    let dimPresets = presets.get(key);
    if (!dimPresets) {
        dimPresets = new Map();
        presets.set(key, dimPresets);
    }
    dimPresets.set(value, color);
}

// The Direction pie and the conversation ranking name the same two things, so
// the pair is pinned rather than handed out in whatever order they first render.
presetColor('direction', 'Sent', sentColor);
presetColor('direction', 'Received', receivedColor);
