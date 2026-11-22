import { ExplorerFiltersStore } from './explorerFilters.svelte';

// A separate instance from listeningExplorerFilters so switching sources never
// leaves the other source's filters active.
export const positionsExplorerFilters = new ExplorerFiltersStore();
