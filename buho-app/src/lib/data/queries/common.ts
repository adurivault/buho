import { query } from '../db';

/** A numeric cell as DuckDB returns it: BIGINT arrives as a BigInt, and any cell can be NULL. */
export type SqlNumber = number | bigint | null;
/** A text cell, NULL included. */
export type SqlText = string | null;

export interface DateRange {
    startDate: string | null;
    endDate: string | null;
}

export interface ListeningDateBounds {
    minDate: string | null;
    maxDate: string | null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string | null): value is string {
    return Boolean(value && ISO_DATE_RE.test(value));
}

export function getDateFilterCondition(
    dateRange: DateRange | undefined,
    column: string = 'timestamp'
): string {
    if (!dateRange) return '';
    const { startDate, endDate } = dateRange;
    if (!isIsoDate(startDate) || !isIsoDate(endDate)) return '';
    // Filter on the pre-truncated `date` column rather than wrapping the column in DATE().
    // `plays` already stores a DATE column alongside the timestamp, so DuckDB can
    // compare it directly instead of evaluating DATE() once per row on every query.
    const dateColumn = column.replace(/timestamp$/, 'date');
    return `${dateColumn} BETWEEN DATE '${startDate}' AND DATE '${endDate}'`;
}

export function whereClause(
    baseConditions: string[],
    dateColumn?: string,
    dateRange?: DateRange
): string {
    const conditions = [...baseConditions];
    if (dateColumn) {
        const filterCondition = getDateFilterCondition(dateRange, dateColumn);
        if (filterCondition) conditions.push(filterCondition);
    }
    return conditions.length > 0 ? `WHERE ${conditions.join('\n          AND ')}` : '';
}

export async function getListeningDateBounds(): Promise<ListeningDateBounds> {
    const sql = `
        SELECT
            CAST(MIN(date) AS VARCHAR) as minDate,
            CAST(MAX(date) AS VARCHAR) as maxDate
        FROM plays
        WHERE date IS NOT NULL
    `;

    try {
        const result = await query<{ minDate: SqlText; maxDate: SqlText }>(sql);
        if (!result || result.length === 0) {
            return { minDate: null, maxDate: null };
        }
        return {
            minDate: result[0].minDate || null,
            maxDate: result[0].maxDate || null,
        };
    } catch (error) {
        console.error('Error fetching Spotify date bounds:', error);
        return { minDate: null, maxDate: null };
    }
}
