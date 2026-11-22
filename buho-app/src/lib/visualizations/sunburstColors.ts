import * as d3 from 'd3';
import { CATEGORICAL_DARK, CATEGORICAL_LIGHT } from '#lib/utils/dimensionColors.ts';

/**
 * Sunburst coloring, in two modes. A source picks the one that matches the shape
 * of its hierarchy — the difference is how many distinct things sit on ring 1.
 *
 *   "spectrum" — hundreds of top-level categories (Spotify: artists). No fixed
 *     palette can name that many, so hues are sampled around the whole wheel and
 *     every descendant simply inherits its ring-1 ancestor's color. Within a
 *     branch, everything is one flat color.
 *
 *   "branch" — a handful of top-level categories (Google activity: ~8 services
 *     that matter, the rest bucketed into "Other"). Ring 1 takes a fixed,
 *     CVD-validated categorical palette; deeper rings derive a shade of their
 *     ancestor's hue, so a branch reads as a family while its children stay apart.
 */
export type SunburstColorMode = 'spectrum' | 'branch';

// --- spectrum ---------------------------------------------------------------

const PALETTE_SIZE = 100;
const HUE_START = 0;
const HUE_END = 360;

/** Hues sampled in order along the color wheel (red → violet). */
export const SUNBURST_PALETTE = d3.quantize(
    (t) => d3.hsl(HUE_START + t * (HUE_END - HUE_START), 0.6, 0.55).formatHex(),
    PALETTE_SIZE
);

// --- branch -----------------------------------------------------------------

/**
 * Ring-1 palette, in fixed slot order — a category keeps its slot, colors are
 * never cycled or reassigned when a filter changes the set on screen.
 *
 * Validated as a set against this app's own chart surfaces (light #ffffff, dark
 * #191715): lightness band, chroma floor, adjacent CVD separation (worst ΔE 9.1
 * light / 8.4 dark) and normal-vision floor (19.6 / 19.3) all pass. Three light
 * steps sit under 3:1 against the light surface, which the arcs' direct labels
 * and the tooltip cover.
 *
 * Past eight, nodes fold into "Other" rather than getting a generated hue.
 */
const BRANCH_LIGHT = CATEGORICAL_LIGHT;

/** The same eight hues, stepped for the dark surface — not a separate palette. */
const BRANCH_DARK = CATEGORICAL_DARK;

/**
 * How a child departs from its parent's color, per ring outwards.
 *
 * Hue fans the siblings around the parent's hue and narrows as rings get
 * thinner; lightness climbs so outer rings read as further out; chroma eases off
 * so the ring-1 hue stays the loudest thing in the branch. All three are
 * deliberately small: this encodes *belonging*, and telling two siblings apart is
 * the job of the arc labels and the tooltip, not of the fill alone.
 */
const HUE_FAN = 34;
const LIGHTNESS_STEP = 7;
const LIGHTNESS_MAX = 88;
const CHROMA_STEP = 6;
const CHROMA_MIN = 20;

/** Ordinal scale over a palette, with a domain that grows on demand. */
function ordinal(range: readonly string[]): d3.ScaleOrdinal<string, string> {
    return d3.scaleOrdinal<string, string>([...range]);
}

/**
 * A node of any sunburst hierarchy, reduced to what coloring needs: its ring, and
 * its position among its siblings. Structural rather than a d3 type so this stays
 * testable without building a hierarchy.
 */
export interface ColorNode {
    /** 0 = root, 1 = first ring. */
    depth: number;
    /** Index among its parent's children, and how many there are. */
    index: number;
    siblings: number;
}

export interface SunburstColorScale {
    /** Color of a node, given its ring-1 ancestor's name and its path below it. */
    color(rootName: string, path: readonly ColorNode[]): string;
}

/**
 * Build a color scale for one sunburst.
 *
 * Stateful on purpose: the ordinal domain grows as names are seen, so a category
 * keeps its color when a filter or the time brush changes which ones are on
 * screen — color follows the entity, never its rank.
 */
export function createSunburstColorScale(
    mode: SunburstColorMode = 'spectrum',
    theme: 'light' | 'dark' = 'dark'
): SunburstColorScale {
    if (mode === 'spectrum') {
        const scale = ordinal(SUNBURST_PALETTE);
        // Every descendant is its ring-1 ancestor's color; the path is unused.
        return { color: (rootName) => scale(rootName) };
    }

    const scale = ordinal(theme === 'light' ? BRANCH_LIGHT : BRANCH_DARK);

    return {
        color(rootName, path) {
            const c = d3.hcl(scale(rootName));
            let ring = 1;
            for (const node of path) {
                ring += 1;
                // Siblings fan symmetrically around the parent's hue: t runs
                // -0.5 … +0.5, so an only child stays exactly on it.
                const t = node.siblings > 1 ? node.index / (node.siblings - 1) - 0.5 : 0;
                c.h += t * (HUE_FAN / (ring - 1));
                c.l = Math.min(LIGHTNESS_MAX, c.l + LIGHTNESS_STEP);
                c.c = Math.max(CHROMA_MIN, c.c - CHROMA_STEP);
            }
            return c.formatHex();
        },
    };
}
