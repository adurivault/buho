/**
 * The calendar's selection: the year that is open, and the day of it.
 *
 * Kept outside the page so that leaving for a module and coming back finds the
 * same day open. In memory only, like every store here: nothing about what was
 * looked at is written anywhere.
 */
class CalendarStore {
    year = $state<number | null>(null);
    /** 'YYYY-MM-DD', always inside {@link year}. */
    day = $state<string | null>(null);

    /** Open `day`, and the year it falls in. */
    selectDay(day: string) {
        this.day = day;
        this.year = Number(day.slice(0, 4));
    }

    reset() {
        this.year = null;
        this.day = null;
    }
}

export const calendarStore = new CalendarStore();
