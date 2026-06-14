// Couleurs partagées des dimensions de l'Explorer (pies, constellation, barcharts).
// Une valeur donnée (ex. "iOS") garde toujours la même couleur, indépendamment
// de son rang. Le registre est partagé entre composants et scoped par dimension
// (filterKey), pour que le camembert "platform", les points de la constellation
// et les barcharts empilés s'accordent au pixel.

// Palette douce accordée au thème (Other = gris).
export const PALETTE = [
    "#4cc38a",
    "#5ab0d6",
    "#e0a458",
    "#c98bdb",
    "#e08a7d",
    "#7ec9a3",
    "#9ab0e0",
    "#d6c25a",
];
export const OTHER_COLOR = "#4a443d";

const colorRegistry = new Map<string, Map<string, string>>();

export function stickyColor(key: string, value: string): string {
    if (value === "Other") return OTHER_COLOR;
    let dimColors = colorRegistry.get(key);
    if (!dimColors) {
        dimColors = new Map();
        colorRegistry.set(key, dimColors);
    }
    let c = dimColors.get(value);
    if (!c) {
        c = PALETTE[dimColors.size % PALETTE.length];
        dimColors.set(value, c);
    }
    return c;
}
