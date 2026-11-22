// DuckDB stores TIMESTAMP/DATE values as naive (no tz). We must serialize using
// LOCAL wall-clock fields (not toISOString, which converts to UTC) so that SQL
// functions like hour()/DATE()/dayofweek() on these columns match the time the
// user actually saw the track played at — including across DST transitions,
// since Date's local getters resolve the correct historical DST offset.
export function formatLocalTimestamp(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatLocalDate(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
