/**
 * Helpers pour ouvrir un élément du catalogue Spotify depuis une URI d'export.
 *
 * Les exports Spotify portent des URIs de la forme `spotify:track:<id>`. On les
 * convertit en URL web (`https://open.spotify.com/track/<id>`) qui ouvre le
 * lecteur web et redirige vers l'app native si elle est installée.
 *
 * Respect de l'invariant vie privée : aucune donnée utilisateur n'est envoyée.
 * On ne fait qu'ouvrir, sur clic explicite, un identifiant public du catalogue
 * Spotify dans un nouvel onglet.
 */

const URI_PATTERN = /^spotify:(track|episode|album|artist):([A-Za-z0-9]+)$/;

/** `spotify:track:ID` → `https://open.spotify.com/track/ID`, ou null si invalide. */
export function spotifyUriToUrl(uri: string | null | undefined): string | null {
    if (!uri) return null;
    const match = URI_PATTERN.exec(uri);
    if (!match) return null;
    const [, type, id] = match;
    return `https://open.spotify.com/${type}/${id}`;
}

/** Ouvre l'élément Spotify dans un nouvel onglet. Renvoie false si l'URI est inutilisable. */
export function openSpotify(uri: string | null | undefined): boolean {
    const url = spotifyUriToUrl(uri);
    if (!url || typeof window === 'undefined') return false;
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
}

/** Touche modificatrice à afficher dans les hints ("⌘" sur Mac/iOS, "Ctrl" ailleurs). */
export const MODIFIER_LABEL =
    typeof navigator !== 'undefined' &&
    /Macintosh|Mac OS X|iPhone|iPad|iPod/.test(navigator.userAgent)
        ? '⌘'
        : 'Ctrl';

/** Vrai si l'event porte le modificateur "ouvrir dans Spotify" (⌘ ou Ctrl). */
export function hasOpenModifier(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
    return event.metaKey || event.ctrlKey;
}
