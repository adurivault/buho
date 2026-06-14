import type { LoadingState } from '../types/common';

let state = $state<LoadingState>({
    dbInitializing: false,
    parsingFile: false,
    spotifyGuideScrollTop: 0
});

export function setDbInitializing(v: boolean) {
    state.dbInitializing = v;
}

export function setParsingFile(v: boolean) {
    state.parsingFile = v;
}

export function setSpotifyGuideScrollTop(v: number) {
    state.spotifyGuideScrollTop = Math.max(0, Math.floor(v));
}

export const uiStore = {
    get dbInitializing() { return state.dbInitializing; },
    get parsingFile() { return state.parsingFile; },
    get spotifyGuideScrollTop() { return state.spotifyGuideScrollTop; }
};
