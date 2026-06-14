import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Page from "./+page.svelte";
import { spotifyExplorerFilters } from "$lib/stores/spotifyExplorerFilters.svelte";

describe("Explore Page", () => {
    beforeEach(() => {
        spotifyExplorerFilters.clearAll();
    });

    it("renders chart placeholders", () => {
        const { container } = render(Page);

        expect(screen.getByText("Rendering universe...")).toBeInTheDocument();
        // Since we removed "Bar Chart", verify the structure instead
        expect(container.querySelector(".explorer-grid")).toBeInTheDocument();
        expect(screen.queryByText("Temporal")).not.toBeInTheDocument();
        expect(screen.queryByText("Hourly")).not.toBeInTheDocument();
    });

    it("shows clear-all button only when filters are active", () => {
        const { rerender } = render(Page);
        expect(screen.queryByRole("button", { name: "Clear all filters" })).not.toBeInTheDocument();

        spotifyExplorerFilters.setFilter("artist_name", "Phoenix");
        rerender({});

        expect(screen.getByRole("button", { name: "Clear all filters" })).toBeInTheDocument();
    });

    it("does not render guide quick link", () => {
        render(Page);
        expect(screen.queryByRole("link", { name: "Back to Guide" })).not.toBeInTheDocument();
    });
});
