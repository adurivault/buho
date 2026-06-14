import * as d3 from "d3";

/**
 * Palette du sunburst : un arc-en-ciel continu et monotone.
 *
 * On échantillonne une vingtaine de teintes vives sur toute la roue chromatique,
 * dans l'ordre du spectre — les arcs consécutifs balaient la roue de proche en
 * proche (rouge → orange → jaune → vert → … → violet).
 */
const PALETTE_SIZE = 100;

// On s'arrête avant le rose/magenta (≈300-360°) : la roue va du rouge au violet
// sans repasser par les teintes roses.
const HUE_START = 0;
const HUE_END = 360;

/** Teintes échantillonnées dans l'ordre sur la roue chromatique (rouge → violet). */
export const SUNBURST_PALETTE = d3.quantize(
    (t) => d3.hsl(HUE_START + t * (HUE_END - HUE_START), 0.6, 0.55
    ).formatHex(),
    PALETTE_SIZE,
);

/** Teinte neutre chaude pour les nœuds "Other" (accordée au thème encre). */
export const SUNBURST_OTHER_COLOR = "#4a443d";

/** Échelle ordinale partagée par les deux sunbursts (domaine extensible). */
export function createSunburstColorScale(): d3.ScaleOrdinal<string, string> {
    return d3.scaleOrdinal<string, string>(SUNBURST_PALETTE);
}
