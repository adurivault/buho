import { ExplorerFiltersStore } from "./explorerFilters.svelte";

// A separate instance from spotifyExplorerFilters so switching sources never
// leaves the other source's filters active.
export const googleMapsExplorerFilters = new ExplorerFiltersStore();
