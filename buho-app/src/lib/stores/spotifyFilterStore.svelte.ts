import { trackThrottled } from "$lib/analytics";

export interface SpotifyDateBounds {
    minDate: string | null;
    maxDate: string | null;
}

interface SetBoundsOptions {
    resetRange?: boolean;
}

class SpotifyFilterStore {
    minDate = $state<string | null>(null);
    maxDate = $state<string | null>(null);
    startDate = $state<string | null>(null);
    endDate = $state<string | null>(null);

    setBounds(bounds: SpotifyDateBounds, options: SetBoundsOptions = {}) {
        this.minDate = bounds.minDate;
        this.maxDate = bounds.maxDate;

        if (!bounds.minDate || !bounds.maxDate) {
            this.startDate = null;
            this.endDate = null;
            return;
        }

        if (options.resetRange) {
            this.startDate = bounds.minDate;
            this.endDate = bounds.maxDate;
            return;
        }

        if (!this.startDate || this.startDate < bounds.minDate || this.startDate > bounds.maxDate) {
            this.startDate = bounds.minDate;
        }
        if (!this.endDate || this.endDate > bounds.maxDate || this.endDate < bounds.minDate) {
            this.endDate = bounds.maxDate;
        }
        if (this.startDate > this.endDate) {
            this.startDate = bounds.minDate;
            this.endDate = bounds.maxDate;
        }
    }

    setRange(startDate: string, endDate: string) {
        if (!this.minDate || !this.maxDate) return;
        // Dates are the user's data — send only that a date filter was used.
        trackThrottled("date-filter", "range");
        const clampedStart = startDate < this.minDate ? this.minDate : startDate;
        const clampedEnd = endDate > this.maxDate ? this.maxDate : endDate;
        this.startDate = clampedStart <= clampedEnd ? clampedStart : clampedEnd;
        this.endDate = clampedEnd >= clampedStart ? clampedEnd : clampedStart;
    }

    reset() {
        this.minDate = null;
        this.maxDate = null;
        this.startDate = null;
        this.endDate = null;
    }

    get hasBounds(): boolean {
        return Boolean(this.minDate && this.maxDate);
    }

    get rangeKey(): string {
        return `${this.startDate ?? ""}|${this.endDate ?? ""}`;
    }
}

export const spotifyFilterStore = new SpotifyFilterStore();
