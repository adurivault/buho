export type Theme = "light" | "dark";

// The theme lives in memory only: no persistence (no localStorage), in line with
// the privacy promise. On load we follow prefers-color-scheme (applied very early
// by an inline script in app.html to avoid the flash), and the toggle overrides it
// for the duration of the session.
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

/** Syncs the store with the class already set on <html> by the inline script. */
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
