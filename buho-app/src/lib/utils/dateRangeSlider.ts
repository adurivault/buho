export function enumerateDates(minDate: string, maxDate: string): string[] {
    const dates: string[] = [];
    const current = new Date(`${minDate}T00:00:00Z`);
    const max = new Date(`${maxDate}T00:00:00Z`);

    while (current <= max) {
        dates.push(current.toISOString().slice(0, 10));
        current.setUTCDate(current.getUTCDate() + 1);
    }

    return dates;
}

function clampIndex(value: number, maxIndex: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(Math.max(Math.trunc(value), 0), maxIndex);
}

export function normalizeRangeIndices(
    allDates: string[],
    startDate: string | null,
    endDate: string | null,
): { startIndex: number; endIndex: number } {
    const maxIndex = Math.max(0, allDates.length - 1);
    if (allDates.length === 0) {
        return { startIndex: 0, endIndex: 0 };
    }

    const defaultStart = 0;
    const defaultEnd = maxIndex;

    const startRaw = startDate ? allDates.indexOf(startDate) : -1;
    const endRaw = endDate ? allDates.indexOf(endDate) : -1;

    const startIndex = startRaw >= 0 ? startRaw : defaultStart;
    const endIndex = endRaw >= 0 ? endRaw : defaultEnd;

    if (startIndex <= endIndex) {
        return { startIndex, endIndex };
    }

    return { startIndex: endIndex, endIndex: startIndex };
}

export function nextStartIndex(
    value: number,
    currentEndIndex: number,
    maxIndex: number,
): number {
    const next = clampIndex(value, maxIndex);
    return Math.min(next, currentEndIndex);
}

export function nextEndIndex(
    value: number,
    currentStartIndex: number,
    maxIndex: number,
): number {
    const next = clampIndex(value, maxIndex);
    return Math.max(next, currentStartIndex);
}

/**
 * Normalise une saisie libre en date ISO `YYYY-MM-DD`.
 * Accepte `YYYY-MM-DD`, `JJ/MM/AAAA` et `JJ-MM-AAAA`.
 * Renvoie `null` si la saisie est vide ou ne représente pas une date valide.
 */
export function parseDateText(text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed) return null;

    let year: number;
    let month: number;
    let day: number;

    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (iso) {
        year = Number(iso[1]);
        month = Number(iso[2]);
        day = Number(iso[3]);
    } else {
        const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
        if (!dmy) return null;
        day = Number(dmy[1]);
        month = Number(dmy[2]);
        year = Number(dmy[3]);
    }

    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    // Vérifie que la date existe réellement (ex: 31/02 rejeté).
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        return null;
    }

    return date.toISOString().slice(0, 10);
}
