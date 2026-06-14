import { beforeEach, describe, expect, it } from "vitest";
import { spotifyExplorerFilters } from "./spotifyExplorerFilters.svelte";

describe("spotifyExplorerFilters", () => {
    beforeEach(() => {
        spotifyExplorerFilters.clearAll();
    });

    it("starts empty", () => {
        expect(spotifyExplorerFilters.activeFilters).toEqual({});
        expect(spotifyExplorerFilters.hasActiveFilters).toBe(false);
    });

    it("sets and removes dynamic filters", () => {
        spotifyExplorerFilters.setFilter("artist_name", "Daft Punk");
        spotifyExplorerFilters.setFilter("date_range", {
            start: "2024-01-01",
            end: "2024-01-31"
        });

        expect(spotifyExplorerFilters.hasActiveFilters).toBe(true);
        expect(spotifyExplorerFilters.activeFilters).toEqual({
            artist_name: "Daft Punk",
            date_range: {
                start: "2024-01-01",
                end: "2024-01-31"
            }
        });

        spotifyExplorerFilters.removeFilter("artist_name");

        expect(spotifyExplorerFilters.activeFilters).toEqual({
            date_range: {
                start: "2024-01-01",
                end: "2024-01-31"
            }
        });
    });

    it("clears all filters", () => {
        spotifyExplorerFilters.setFilter("hour", [7, 8, 9]);
        expect(spotifyExplorerFilters.hasActiveFilters).toBe(true);

        spotifyExplorerFilters.clearAll();

        expect(spotifyExplorerFilters.activeFilters).toEqual({});
        expect(spotifyExplorerFilters.hasActiveFilters).toBe(false);
    });
});
