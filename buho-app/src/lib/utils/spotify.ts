/**
 * Helpers to open a Spotify catalog item from an export URI.
 *
 * Spotify exports carry URIs of the form `spotify:track:<id>`. We convert them to
 * a web URL (`https://open.spotify.com/track/<id>`) that opens the web player and
 * redirects to the native app if installed.
 *
 * Respects the privacy invariant: no user data is sent. We merely open, on an
 * explicit click, a public Spotify catalog identifier in a new tab.
 */

const URI_PATTERN = /^spotify:(track|episode|album|artist):([A-Za-z0-9]+)$/;

/** `spotify:track:ID` → `https://open.spotify.com/track/ID`, or null if invalid. */
export function spotifyUriToUrl(uri: string | null | undefined): string | null {
    if (!uri) return null;
    const match = URI_PATTERN.exec(uri);
    if (!match) return null;
    const [, type, id] = match;
    return `https://open.spotify.com/${type}/${id}`;
}

/** Opens the Spotify item in a new tab. Returns false if the URI is unusable. */
export function openSpotify(uri: string | null | undefined): boolean {
    const url = spotifyUriToUrl(uri);
    if (!url || typeof window === 'undefined') return false;
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
}

/** Modifier key to show in hints ("⌘" on Mac/iOS, "Ctrl" elsewhere). */
export const MODIFIER_LABEL =
    typeof navigator !== 'undefined' &&
    /Macintosh|Mac OS X|iPhone|iPad|iPod/.test(navigator.userAgent)
        ? '⌘'
        : 'Ctrl';

/** True if the event carries the "open in Spotify" modifier (⌘ or Ctrl). */
export function hasOpenModifier(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
    return event.metaKey || event.ctrlKey;
}
