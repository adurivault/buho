interface UiState {
    listeningGuideScrollTop: number;
    /** Whether any modal is up. See openModal/closeModal. */
    modalOpen: boolean;
}

const state = $state<UiState>({
    listeningGuideScrollTop: 0,
    modalOpen: false,
});

/**
 * How many modals are up. Counted rather than flagged so one closing can't clear
 * the state of one that has just opened, and deliberately **not** reactive: the
 * component announcing itself does so from an `$effect`, and a counter it had to
 * read to increment would make itself a dependency of that effect — which then
 * reruns, increments again, and loops.
 */
let modalCount = 0;

export function setListeningGuideScrollTop(v: number) {
    state.listeningGuideScrollTop = Math.max(0, Math.floor(v));
}

/**
 * Announce a modal opening and closing.
 *
 * What reads it is the window-wide drop overlay, which has to stand down while a
 * dialog is up: a full-screen panel painting over the modal you just opened is
 * the app talking over itself. The modal takes drops itself for as long as it
 * is open.
 */
export function openModal() {
    modalCount += 1;
    state.modalOpen = true;
}

export function closeModal() {
    modalCount = Math.max(0, modalCount - 1);
    state.modalOpen = modalCount > 0;
}

export const uiStore = {
    get listeningGuideScrollTop() {
        return state.listeningGuideScrollTop;
    },
    get modalOpen() {
        return state.modalOpen;
    },
};
