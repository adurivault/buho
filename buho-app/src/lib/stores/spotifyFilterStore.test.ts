import { beforeEach, describe, expect, it } from "vitest";
import { spotifyFilterStore } from "./spotifyFilterStore.svelte";

describe("spotifyFilterStore", () => {
    beforeEach(() => {
        spotifyFilterStore.reset();
    });

    it("setBounds initializes range to full bounds", () => {
        spotifyFilterStore.setBounds({
            minDate: "2024-01-01",
            maxDate: "2024-01-31",
        });

        expect(spotifyFilterStore.startDate).toBe("2024-01-01");
        expect(spotifyFilterStore.endDate).toBe("2024-01-31");
    });

    it("setBounds with resetRange forces a full-range reset", () => {
        spotifyFilterStore.setBounds({
            minDate: "2024-01-01",
            maxDate: "2024-01-31",
        });
        spotifyFilterStore.setRange("2024-01-10", "2024-01-20");

        spotifyFilterStore.setBounds(
            { minDate: "2025-03-01", maxDate: "2025-03-31" },
            { resetRange: true },
        );

        expect(spotifyFilterStore.startDate).toBe("2025-03-01");
        expect(spotifyFilterStore.endDate).toBe("2025-03-31");
    });

    it("setRange clamps inside bounds", () => {
        spotifyFilterStore.setBounds({
            minDate: "2024-01-01",
            maxDate: "2024-01-31",
        });

        spotifyFilterStore.setRange("2023-12-01", "2024-02-10");

        expect(spotifyFilterStore.startDate).toBe("2024-01-01");
        expect(spotifyFilterStore.endDate).toBe("2024-01-31");
    });

    it("setRange never leaves start after end", () => {
        spotifyFilterStore.setBounds({
            minDate: "2024-01-01",
            maxDate: "2024-01-31",
        });

        spotifyFilterStore.setRange("2024-01-20", "2024-01-10");

        expect(spotifyFilterStore.startDate).toBe("2024-01-10");
        expect(spotifyFilterStore.endDate).toBe("2024-01-20");
    });
});
