/**
 * Whether Buho is open on a phone, and whether whoever holds it asked for the
 * full app anyway.
 *
 * On a phone the Explorers are not offered by default. Their charts are read by
 * pointing — hover readouts, brushes, slices to click — and at 390 pixels with a
 * finger that is a worse experience than a clip of it and a link to open it on a
 * computer. The guides, which are read by scrolling, stay as they are.
 *
 * "A phone" is a coarse pointer on a narrow screen, not a user-agent: a tablet
 * held wide gets the full app, and so does a narrow desktop window.
 *
 * The override lives in memory only, like the theme: nothing is persisted, so
 * "explore anyway" lasts until the tab is closed and a reload asks again.
 */

const HANDHELD_QUERY = '(pointer: coarse) and (max-width: 767px)';

function watch(): MediaQueryList | null {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
    return window.matchMedia(HANDHELD_QUERY);
}

// Read when the module loads rather than on mount, so the first paint on a
// phone is already the right one instead of the Explorer flashing past.
const query = watch();
const state = $state({ handheld: query?.matches ?? false, fullAnyway: false });
query?.addEventListener?.('change', (event) => {
    state.handheld = event.matches;
});

/** Lifts the phone treatment for the rest of the session. */
export function exploreAnyway(): void {
    state.fullAnyway = true;
}

export const deviceStore = {
    /** A coarse pointer on a phone-width screen. */
    get handheld() {
        return state.handheld;
    },
    /** Show the phone treatment: handheld, and not overridden. */
    get showcase() {
        return state.handheld && !state.fullAnyway;
    },
};
