/**
 * Lit les tokens de thème (définis en HSL dans app.css) depuis le DOM, pour que
 * les visualisations Canvas/D3 — qui manipulent des chaînes de couleur, pas du
 * CSS — suivent le toggle light/dark. À appeler au moment du rendu ; côté charts,
 * dépendre de `themeStore.theme` dans l'effet de rendu suffit à re-render au toggle.
 */
function readToken(token: string): string {
    if (typeof document === "undefined") return "";
    return getComputedStyle(document.documentElement)
        .getPropertyValue(token)
        .trim();
}

/** Renvoie un token couleur sous forme `hsl(...)` (ou un fallback si indisponible). */
export function themeHsl(token: string, fallback = "transparent"): string {
    const v = readToken(token);
    return v ? `hsl(${v})` : fallback;
}

/** Couleurs de thème usuelles pour les visualisations. */
export function vizColors() {
    return {
        background: themeHsl("--background", "#16130f"),
        foreground: themeHsl("--foreground", "#e7e2da"),
        border: themeHsl("--border", "rgb(71 85 105 / 0.45)"),
        muted: themeHsl("--muted", "#2e2922"),
        mutedForeground: themeHsl("--muted-foreground", "#988e80"),
    };
}
