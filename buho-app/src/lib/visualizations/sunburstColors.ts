import * as d3 from "d3";

/**
 * Sunburst palette: a continuous, monotonic rainbow.
 *
 * We sample about twenty vivid hues across the whole color wheel, in spectrum
 * order — consecutive arcs sweep the wheel step by step (red → orange → yellow →
 * green → … → violet).
 */
const PALETTE_SIZE = 100;

// We stop before pink/magenta (≈300-360°): the wheel goes from red to violet
// without looping back through the pink hues.
const HUE_START = 0;
const HUE_END = 360;

/** Hues sampled in order along the color wheel (red → violet). */
export const SUNBURST_PALETTE = d3.quantize(
    (t) => d3.hsl(HUE_START + t * (HUE_END - HUE_START), 0.6, 0.55
    ).formatHex(),
    PALETTE_SIZE,
);

/** Warm neutral hue for the "Other" nodes (tuned to the ink theme). */
export const SUNBURST_OTHER_COLOR = "#4a443d";

/** Ordinal scale shared by both sunbursts (extensible domain). */
export function createSunburstColorScale(): d3.ScaleOrdinal<string, string> {
    return d3.scaleOrdinal<string, string>(SUNBURST_PALETTE);
}
