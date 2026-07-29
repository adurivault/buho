/**
 * Reads the theme tokens (defined in HSL in app.css) from the DOM, so that the
 * Canvas/D3 visualizations — which manipulate color strings, not CSS — follow the
 * light/dark toggle. Call it at render time; on the chart side, depending on
 * `themeStore.theme` inside the render effect is enough to re-render on toggle.
 */
function readToken(token: string): string {
    if (typeof document === "undefined") return "";
    return getComputedStyle(document.documentElement)
        .getPropertyValue(token)
        .trim();
}

/** Returns a color token as `hsl(...)` (or a fallback if unavailable). */
export function themeHsl(token: string, fallback = "transparent"): string {
    const v = readToken(token);
    return v ? `hsl(${v})` : fallback;
}

/** Common theme colors for the visualizations. */
export function vizColors() {
    return {
        background: themeHsl("--background", "#16130f"),
        foreground: themeHsl("--foreground", "#e7e2da"),
        border: themeHsl("--border", "rgb(71 85 105 / 0.45)"),
        muted: themeHsl("--muted", "#2e2922"),
        mutedForeground: themeHsl("--muted-foreground", "#988e80"),
    };
}
