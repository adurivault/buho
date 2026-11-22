import type { RawSpotifyEntry } from '#lib/data/sources/spotify/types.ts';

/**
 * The measurements that decide whether a listening history looks alive.
 *
 * These exist because "the demo feels too smooth" is not actionable and cannot
 * be regression-tested. Every number here is one the charts depend on, so a
 * generated history can be held against a real export and the gap read off
 * rather than argued about. Run `node scripts/demo-stats.mjs <export>` to do
 * exactly that.
 *
 * Nothing here is Buho-specific analysis — it deliberately works on the raw
 * export shape, so the same function measures a generated file and the real
 * thing that came out of Spotify.
 */

export interface ListeningStats {
    plays: number;
    artists: number;
    tracks: number;
    firstDay: string;
    lastDay: string;
    daysSpanned: number;
    /** Days inside the span with no plays at all. */
    emptyDays: number;
    /** The longest run of consecutive empty days — a lost phone, a year away. */
    longestGapDays: number;
    /** Share of the day's plays falling in each hour, 0..23. */
    hourShares: number[];
    /** Busiest hour over quietest hour. Uniform noise sits at ~1. */
    peakTroughRatio: number;
    /** Plays per weekend day over plays per weekday. */
    weekendRatio: number;
    /** Share of all plays belonging to the single most-played artist. */
    topArtistShare: number;
    /** Most-played artist over the tenth most-played. Uniform sits at ~1. */
    topToTenthRatio: number;
    /** Slope of log(plays) against log(rank). A power law is around -1. */
    zipfSlope: number;
    /**
     * Share of plays starting within five minutes of the previous one — how
     * much listening comes in sessions rather than as scattered singles.
     */
    clumping: number;
    /**
     * For the most-played artist, the share of its plays inside its busiest
     * 90-day window. Taste with eras concentrates; taste drawn from a bag does
     * not.
     */
    topArtistPeakWindow: number;
    skipRate: number;
    medianMsPlayed: number;
}

const DAY_MS = 86_400_000;

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Least-squares slope of log(count) on log(rank), over the ranks that matter. */
function fitZipfSlope(counts: number[]): number {
    const ranked = [...counts]
        .sort((a, b) => b - a)
        .slice(0, 40)
        .filter((count) => count > 0);
    if (ranked.length < 5) return 0;

    const xs = ranked.map((_, index) => Math.log(index + 1));
    const ys = ranked.map((count) => Math.log(count));
    const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
    const meanY = ys.reduce((sum, y) => sum + y, 0) / ys.length;

    let numerator = 0;
    let denominator = 0;
    for (let index = 0; index < xs.length; index += 1) {
        numerator += (xs[index] - meanX) * (ys[index] - meanY);
        denominator += (xs[index] - meanX) ** 2;
    }
    return denominator === 0 ? 0 : numerator / denominator;
}

export function measureListening(entries: RawSpotifyEntry[]): ListeningStats {
    if (entries.length === 0) throw new Error('measureListening: no entries');

    const times = entries.map((entry) => new Date(entry.ts).getTime()).sort((a, b) => a - b);
    const first = times[0];
    const last = times[times.length - 1];
    const daysSpanned = Math.max(1, Math.round((last - first) / DAY_MS) + 1);

    const hours = new Array(24).fill(0);
    const perDay = new Map<number, number>();
    const perArtist = new Map<string, number>();
    const tracks = new Set<string>();
    const artistTimes = new Map<string, number[]>();
    let weekendPlays = 0;
    let skips = 0;

    for (const entry of entries) {
        const when = new Date(entry.ts);
        hours[when.getHours()] += 1;

        const dayKey = Math.floor((when.getTime() - first) / DAY_MS);
        perDay.set(dayKey, (perDay.get(dayKey) ?? 0) + 1);

        const weekday = when.getDay();
        if (weekday === 0 || weekday === 6) weekendPlays += 1;

        const artist = entry.master_metadata_album_artist_name;
        if (artist) {
            perArtist.set(artist, (perArtist.get(artist) ?? 0) + 1);
            const list = artistTimes.get(artist);
            if (list) list.push(when.getTime());
            else artistTimes.set(artist, [when.getTime()]);
        }
        if (entry.master_metadata_track_name) {
            tracks.add(`${artist ?? ''}\u0000${entry.master_metadata_track_name}`);
        }
        if (entry.skipped || entry.ms_played < 30_000) skips += 1;
    }

    // Empty days and the longest run of them.
    let emptyDays = 0;
    let longestGapDays = 0;
    let currentGap = 0;
    for (let day = 0; day < daysSpanned; day += 1) {
        if (perDay.has(day)) {
            currentGap = 0;
        } else {
            emptyDays += 1;
            currentGap += 1;
            if (currentGap > longestGapDays) longestGapDays = currentGap;
        }
    }

    const hourShares = hours.map((count) => count / entries.length);
    const peak = Math.max(...hours);
    const trough = Math.max(1, Math.min(...hours));

    // Weekend days are two sevenths of a week; normalise before comparing.
    const weekendDays = Math.max(1, (daysSpanned * 2) / 7);
    const weekdayDays = Math.max(1, (daysSpanned * 5) / 7);
    const weekendRatio =
        weekendPlays / weekendDays / Math.max(1e-9, (entries.length - weekendPlays) / weekdayDays);

    const artistCounts = [...perArtist.values()].sort((a, b) => b - a);
    const topArtistShare = (artistCounts[0] ?? 0) / entries.length;
    const topToTenthRatio = (artistCounts[0] ?? 0) / Math.max(1, artistCounts[9] ?? 1);

    // How much of the listening arrives back-to-back.
    let clumped = 0;
    for (let index = 1; index < times.length; index += 1) {
        if (times[index] - times[index - 1] < 5 * 60_000) clumped += 1;
    }

    // The top artist's busiest quarter, as a share of everything they got.
    const topArtist = [...perArtist.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    let topArtistPeakWindow = 0;
    if (topArtist) {
        const stamps = (artistTimes.get(topArtist) ?? []).sort((a, b) => a - b);
        const window = 90 * DAY_MS;
        let start = 0;
        let best = 0;
        for (let end = 0; end < stamps.length; end += 1) {
            while (stamps[end] - stamps[start] > window) start += 1;
            best = Math.max(best, end - start + 1);
        }
        topArtistPeakWindow = best / stamps.length;
    }

    return {
        plays: entries.length,
        artists: perArtist.size,
        tracks: tracks.size,
        firstDay: new Date(first).toISOString().slice(0, 10),
        lastDay: new Date(last).toISOString().slice(0, 10),
        daysSpanned,
        emptyDays,
        longestGapDays,
        hourShares,
        peakTroughRatio: peak / trough,
        weekendRatio,
        topArtistShare,
        topToTenthRatio,
        zipfSlope: fitZipfSlope(artistCounts),
        clumping: times.length > 1 ? clumped / (times.length - 1) : 0,
        topArtistPeakWindow,
        skipRate: skips / entries.length,
        medianMsPlayed: median(entries.map((entry) => entry.ms_played)),
    };
}

/** A one-screen report, for the CLI and for eyeballing a real export. */
export function formatStats(stats: ListeningStats): string {
    const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
    const bars = stats.hourShares.map((share) => {
        const peak = Math.max(...stats.hourShares) || 1;
        return '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor((share / peak) * 8))] ?? '▁';
    });

    return [
        `plays                ${stats.plays.toLocaleString('en-US')}`,
        `artists / tracks     ${stats.artists} / ${stats.tracks.toLocaleString('en-US')}`,
        `span                 ${stats.firstDay} → ${stats.lastDay} (${stats.daysSpanned} days)`,
        `empty days           ${stats.emptyDays} (longest gap ${stats.longestGapDays} days)`,
        ``,
        `hour of day          ${bars.join('')}`,
        `                     0h      6h      12h     18h    23h`,
        `peak / trough        ${stats.peakTroughRatio.toFixed(1)}×   (uniform noise ≈ 1)`,
        `weekend / weekday    ${stats.weekendRatio.toFixed(2)}×`,
        ``,
        `top artist share     ${pct(stats.topArtistShare)}`,
        `top / 10th artist    ${stats.topToTenthRatio.toFixed(1)}×   (uniform noise ≈ 1)`,
        `zipf slope           ${stats.zipfSlope.toFixed(2)}    (a power law ≈ -1)`,
        `top artist's best 90d ${pct(stats.topArtistPeakWindow)}  (no eras ≈ 2-3%)`,
        ``,
        `sessions (<5min gap) ${pct(stats.clumping)}`,
        `skip rate            ${pct(stats.skipRate)}`,
        `median play          ${(stats.medianMsPlayed / 1000).toFixed(0)}s`,
    ].join('\n');
}
