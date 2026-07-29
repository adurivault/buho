import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExplorerFiltersStore } from "./explorerFilters.svelte";

/**
 * The Explorer's filter events are the app's most detailed telemetry, so they
 * are also where a leak of the user's own data would be easiest. These tests
 * pin what leaves the browser: dimension keys, origins and counts — never a
 * selected value.
 */
describe("explorer filter analytics", () => {
    let track: ReturnType<typeof vi.fn>;
    let filters: ExplorerFiltersStore;

    const payloads = (name: string) =>
        track.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

    beforeEach(() => {
        track = vi.fn();
        (window as unknown as { umami?: unknown }).umami = { track };
        window.history.replaceState({}, "", "/spotify/explore");
        filters = new ExplorerFiltersStore();
    });

    afterEach(() => {
        delete (window as unknown as { umami?: unknown }).umami;
    });

    it("reports the dimension and the view it came from", () => {
        filters.setFilter("artist_name", "Daft Punk", "sunburst");

        expect(payloads("filter-set")[0]).toMatchObject({
            source: "spotify",
            mode: "explore",
            dimension: "artist_name",
            origin: "sunburst",
            dimOrigin: "artist_name@sunburst",
            values: "1"
        });
    });

    it("never sends the selected value", () => {
        filters.setFilter("artist_name", "Daft Punk", "pie");
        filters.setFilter("year", new Set([2023, 2024]), "bar");

        const serialized = JSON.stringify(track.mock.calls);
        expect(serialized).not.toContain("Daft Punk");
        expect(serialized).not.toContain("2023");
    });

    it("counts multi-select values in a bucket", () => {
        filters.setFilter("album", [2019, 2020, 2021, 2022, 2023], "bar");
        expect(payloads("filter-set")[0]).toMatchObject({ values: "4-10" });
    });

    it("reports which dimensions are used together", () => {
        filters.setFilter("hour_of_day", 20, "constellation");
        filters.setFilter("device", "phone", "pie");

        const combos = payloads("filter-combo").map((p) => (p as { combo: string }).combo);
        expect(combos).toContain("device+hour_of_day");
    });

    it("reports the combination that was cleared, and only when there was one", () => {
        filters.clearAll();
        expect(payloads("filter-clear")).toHaveLength(0);

        filters.setFilter("platform", "web", "pie");
        filters.clearAll("unknown");

        expect(payloads("filter-clear")[0]).toMatchObject({ combo: "platform", dimensions: "1" });
    });

    it("stays silent when removing a filter that is not applied", () => {
        filters.removeFilter("skipped", "pie");
        expect(payloads("filter-remove")).toHaveLength(0);
    });
});
