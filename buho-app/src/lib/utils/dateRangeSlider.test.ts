import { describe, expect, it } from "vitest";
import {
    enumerateDates,
    nextEndIndex,
    nextStartIndex,
    normalizeRangeIndices,
    parseDateText,
} from "./dateRangeSlider";

describe("dateRangeSlider", () => {
    it("enumerateDates returns inclusive date list", () => {
        expect(enumerateDates("2024-01-01", "2024-01-03")).toEqual([
            "2024-01-01",
            "2024-01-02",
            "2024-01-03",
        ]);
    });

    it("normalizeRangeIndices keeps ordering even when dates are inverted", () => {
        const dates = ["2024-01-01", "2024-01-02", "2024-01-03"];
        expect(
            normalizeRangeIndices(dates, "2024-01-03", "2024-01-01"),
        ).toEqual({ startIndex: 0, endIndex: 2 });
    });

    it("normalizeRangeIndices falls back to full range when dates are missing", () => {
        const dates = ["2024-01-01", "2024-01-02", "2024-01-03"];
        expect(normalizeRangeIndices(dates, "2023-12-31", null)).toEqual({
            startIndex: 0,
            endIndex: 2,
        });
    });

    it("nextStartIndex never crosses current end", () => {
        expect(nextStartIndex(8, 5, 10)).toBe(5);
        expect(nextStartIndex(-3, 5, 10)).toBe(0);
    });

    it("nextEndIndex never crosses current start", () => {
        expect(nextEndIndex(1, 4, 10)).toBe(4);
        expect(nextEndIndex(30, 4, 10)).toBe(10);
    });

    describe("parseDateText", () => {
        it("accepts ISO format", () => {
            expect(parseDateText("2024-03-09")).toBe("2024-03-09");
        });

        it("accepts DD/MM/YYYY and DD-MM-YYYY, normalising to ISO", () => {
            expect(parseDateText("9/3/2024")).toBe("2024-03-09");
            expect(parseDateText("09/03/2024")).toBe("2024-03-09");
            expect(parseDateText("09-03-2024")).toBe("2024-03-09");
        });

        it("trims surrounding whitespace", () => {
            expect(parseDateText("  2024-03-09  ")).toBe("2024-03-09");
        });

        it("rejects empty and malformed input", () => {
            expect(parseDateText("")).toBeNull();
            expect(parseDateText("   ")).toBeNull();
            expect(parseDateText("not a date")).toBeNull();
            expect(parseDateText("2024/03/09")).toBeNull();
        });

        it("rejects impossible calendar dates", () => {
            expect(parseDateText("2024-02-31")).toBeNull();
            expect(parseDateText("31/02/2024")).toBeNull();
            expect(parseDateText("2024-13-01")).toBeNull();
        });
    });
});
