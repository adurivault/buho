import type { AppError } from '../types/common';

interface ErrorState {
    error: AppError | null;
}

let state = $state<ErrorState>({
    error: null
});

export function setError(error: AppError) {
    state.error = error;
}

export function clearError() {
    state.error = null;
}

export const errorStore = {
    get error() { return state.error; }
};
