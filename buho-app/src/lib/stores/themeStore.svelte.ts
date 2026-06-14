export type Theme = "light" | "dark";

// Le thème vit en mémoire uniquement : aucune persistance (pas de localStorage),
// conformément à la promesse privacy. Au chargement on suit prefers-color-scheme
// (appliqué très tôt par un script inline dans app.html pour éviter le flash),
// et le toggle override pour la durée de la session.
let state = $state<{ theme: Theme }>({ theme: "dark" });

function apply(theme: Theme) {
    if (typeof document !== "undefined") {
        document.documentElement.classList.toggle("dark", theme === "dark");
    }
}

export function setTheme(theme: Theme) {
    state.theme = theme;
    apply(theme);
}

export function toggleTheme() {
    setTheme(state.theme === "dark" ? "light" : "dark");
}

/** Synchronise le store avec la classe déjà posée sur <html> par le script inline. */
export function initTheme() {
    if (typeof document === "undefined") return;
    state.theme = document.documentElement.classList.contains("dark")
        ? "dark"
        : "light";
}

export const themeStore = {
    get theme() {
        return state.theme;
    },
};
