<script lang="ts">
    import { chartFont } from '#lib/visualizations/themeColors.ts';
    import { onDestroy, onMount, untrack } from 'svelte';
    import type { DayRecord, DayRaceSegmentRows } from '#lib/data/queries/positionsQueries.ts';
    import { ACTIVITY_OTHER } from '#lib/data/queries/positionsQueries.ts';
    import {
        buildDayTraces,
        buildActivityTraces,
        clusterOrigins,
        clockAt,
        progressOf,
        sampleHeads,
        type RelativeTrack,
    } from '#lib/visualizations/relativeTraces.ts';
    import { ACTIVITY_RGB, categoryRgb, activityLabel } from '#lib/visualizations/tracePalette.ts';
    import { interpolateTurbo, rgb as d3rgb } from 'd3';
    import { themeStore } from '#lib/stores/themeStore.svelte.ts';
    import { trackControl } from '#lib/analytics.ts';
    import ShareMenu from '#lib/components/ShareMenu.svelte';
    import { clipDurationMs, type ShareSource } from '#lib/export/index.ts';

    /**
     * Traces laid over one another, all from the same point.
     *
     * The sibling map answers "where"; this answers "what shape". Every trace is
     * moved so its own first recorded point sits at the centre, then they all
     * run at once — so a year of commutes settles into one dense star and the
     * outings that broke the pattern are the strands that leave it. There is no
     * basemap on purpose: with everything moved on top of everything else, a
     * background would only be right for one of them.
     *
     * What a trace *is* comes from `mode`, and the two answers are not
     * interchangeable — see `relativeTraces.ts`. Everything below is common to
     * both: the canvas, the clock, the zoom, the colour buckets.
     *
     * Rendering is two stacked canvases. The lower one *accumulates* — each
     * frame inks the clock slices that have gone by and nothing is erased —
     * which is what makes the picture build up as it plays. The upper one holds
     * the slice in progress and the moving heads, and is cleared every frame.
     */
    interface Props {
        days: DayRecord[];
        segments: DayRaceSegmentRows;
        /**
         * days: one trace per logical day, on the clock of the day.
         * activities: one trace per recorded outing, on its own duration.
         */
        mode: 'days' | 'activities';
    }

    let { days, segments, mode }: Props = $props();

    /**
     * The whole clock plays in 3 minutes at 1× — half the map's pace.
     *
     * The map draws a fixed comet: at any speed you are looking at where the
     * dots are now. Here the ink stays, so 1× is the setting where a single
     * strand can be followed as it is laid down, and going slower is the only
     * way to watch the picture actually build. The speeds above it are how you
     * get through a decade.
     *
     * The playhead moves at a constant rate, not the clock: on the activity plot
     * the clock has a knee in it, and it is the *playing* that should be even.
     */
    const PLAY_MS = 180000;
    const SPEEDS = [1, 2, 4, 8, 16] as const;
    const HEIGHT = 620;
    /** How much of the half-frame the 98th-percentile reach fills at rest. */
    const FIT_FRACTION = 0.88;
    const ZOOM_STEP = 1.35;
    /** How far in and out of the fitted scale the view is allowed to go. */
    const ZOOM_RANGE = [1 / 30, 500] as const;

    const dataset = $derived(
        mode === 'activities' ? buildActivityTraces(segments, days) : buildDayTraces(segments, days)
    );

    /**
     * Whether colouring by activity says anything.
     *
     * Only offered on the activity plot. A watch types every fix it records; a
     * Timeline only types the legs its semantic layer managed to classify, and
     * on a day plot that leaves most of the picture in the "not recorded" grey —
     * a legend mostly about the gaps in the labelling rather than about the
     * days. Two real kinds is the floor below which the mode is a flat colour
     * under another name.
     */
    const hasActivities = $derived(
        mode === 'activities' &&
            dataset.kindDays.filter((n, kind) => n > 0 && kind !== ACTIVITY_OTHER).length >= 2
    );

    let clockMin = $state(0);
    let playing = $state(false);
    let speed = $state<(typeof SPEEDS)[number]>(1);
    /**
     * What the colour of a trace means.
     *
     * activity: what you were doing, per leg — the only one that changes colour
     * *along* a trace, and the only one that needs a watch.
     * date: where the trace sits on the whole history, on a continuous scale.
     * origin: roughly where it set off from.
     */
    type ColorMode = 'activity' | 'date' | 'origin';
    let colorMode = $state<ColorMode>('date');

    const COLOR_MODES: Array<{ key: ColorMode; label: string }> = [
        { key: 'date', label: 'Date' },
        { key: 'origin', label: 'Start' },
        { key: 'activity', label: 'Activity' },
    ];

    /** A bucket, when the legend is filtering down to one. */
    let isolate = $state<number | null>(null);
    let visible = $state(false);

    let shell = $state<HTMLDivElement | null>(null);
    let trailCanvas = $state<HTMLCanvasElement | null>(null);
    let headCanvas = $state<HTMLCanvasElement | null>(null);

    let trailCtx: CanvasRenderingContext2D | null = null;
    let headCtx: CanvasRenderingContext2D | null = null;
    let cssWidth = 0;
    let cssHeight = HEIGHT;

    /**
     * The view the canvas was last *rasterised* at: pixels per metre, and the
     * origin's offset from the canvas centre.
     *
     * Deliberately plain `let`, not `$state`: nothing in the markup reads them,
     * and the canvas is repainted by hand. As reactive state they would be read
     * by every paint and so become dependencies of the effect below — which
     * *writes* the scale when it refits, so a zoom would immediately be undone
     * by the reset it triggered.
     */
    let pxPerM = 0.02;
    let panX = 0;
    let panY = 0;

    /**
     * The view the *pointer* has asked for, which runs ahead of the one on the
     * canvas while a gesture is in flight. See `nudgeView`.
     */
    let viewPxPerM = 0.02;
    let viewPanX = 0;
    let viewPanY = 0;

    // Per-frame scratch for the heads, resized with the track count.
    let xy = new Float32Array(0);
    let headSeg = new Int32Array(0);
    let aliveBuf = new Uint8Array(0);

    /** Where the clock runs to, and how it is paced along the way. */
    const span = $derived(dataset.span);
    const knee = $derived(dataset.knee);

    /** The playhead, 0 → 1. The clock is derived from it, never the reverse. */
    const progress = $derived(progressOf(clockMin, span, knee));

    const clockLabel = $derived.by(() => {
        const total = Math.floor(clockMin);
        const pad = (n: number) => String(n).padStart(2, '0');
        if (dataset.timeBase === 'elapsed') {
            return `+${Math.floor(total / 60)}:${pad(total % 60)}`;
        }
        // A day starts at 04:00, so the clock has to be put back on the wall.
        const wall = (4 * 60 + total) % 1440;
        return `${pad(Math.floor(wall / 60))}:${pad(wall % 60)}`;
    });

    /** Where the gear change sits on the bar, as a percentage, or null. */
    const kneePct = $derived(knee ? progressOf(knee.min, span, knee) * 100 : null);

    const kneeLabel = $derived.by(() => {
        if (!knee) return '';
        const total = Math.floor(knee.min);
        return total >= 60
            ? `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')}`
            : `${total} min`;
    });

    /* ------------------------------------------------------------ projection */

    const sx = (x: number) => cssWidth / 2 + panX + x * pxPerM;
    const sy = (y: number) => cssHeight / 2 + panY - y * pxPerM;

    /** Device pixels per CSS pixel, fixed when the canvases are sized. */
    let dpr = 1;

    /** CSS-pixel coordinates, y down: the rings, their labels, the heads. */
    function screenSpace(ctx: CanvasRenderingContext2D) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /**
     * Metre coordinates, y up — the coordinates the traces are stored in.
     *
     * Line width is divided back out of the scale so a stroke still lands as one
     * CSS pixel however far in the view is zoomed. Nothing is approximated here:
     * the rasteriser applies the same affine map the JS used to apply by hand.
     */
    function dataSpace(ctx: CanvasRenderingContext2D) {
        const s = dpr * pxPerM;
        ctx.setTransform(s, 0, 0, -s, dpr * (cssWidth / 2 + panX), dpr * (cssHeight / 2 + panY));
        ctx.lineWidth = 1 / pxPerM;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    }

    /* ----------------------------------------------------------- colour buckets */

    /** Steps in the date ramp. Enough that a decade of days reads as a gradient. */
    const DATE_BUCKETS = 24;

    interface Buckets {
        count: number;
        rgb: Array<[number, number, number]>;
        /** Which bucket one leg of one day falls in. */
        at: (trackIndex: number, segIndex: number) => number;
        /** Days per bucket, for the legend and for the ink scale. */
        days: number[];
        /** Legend entries, or null where the scale is continuous. */
        keys: Array<{ bucket: number; label: string; days: number }> | null;
    }

    const dayMs = (day: string) => {
        const [y, m, d] = day.split('-').map(Number);
        return Date.UTC(y, m - 1, d);
    };
    const MONTHS = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
    ];
    const fmtMonthYear = (day: string) => {
        const [y, m] = day.split('-');
        return `${MONTHS[+m - 1]} ${y}`;
    };

    /** The span the date ramp is stretched over (tracks are sorted by day). */
    const dateRange = $derived.by(() => {
        const t = dataset.tracks;
        if (!t.length) return null;
        const lo = t[0].day;
        const hi = t[t.length - 1].day;
        return { lo, hi, loMs: dayMs(lo), hiMs: dayMs(hi) };
    });

    /** Turbo, sampled once per step, as the canvas wants it. */
    const DATE_RGB: Array<[number, number, number]> = Array.from(
        { length: DATE_BUCKETS },
        (_, i) => {
            const c = d3rgb(interpolateTurbo(i / (DATE_BUCKETS - 1)));
            return [c.r, c.g, c.b] as [number, number, number];
        }
    );

    const DATE_GRADIENT = `linear-gradient(to right, ${DATE_RGB.map(
        ([r, g, b], i) => `rgb(${r} ${g} ${b}) ${Math.round((i / (DATE_BUCKETS - 1)) * 100)}%`
    ).join(', ')})`;

    /** A bucket's colour as CSS, for the legend swatches. */
    const swatch = (bucket: number): string => {
        const [r, g, b] = buckets.rgb[bucket] ?? [140, 131, 122];
        return `rgb(${r} ${g} ${b})`;
    };

    const buckets = $derived.by((): Buckets => {
        const tracks = dataset.tracks;

        if (colorMode === 'activity') {
            return {
                count: ACTIVITY_RGB.length,
                rgb: ACTIVITY_RGB,
                at: (ti, si) => tracks[ti].activity[si],
                days: dataset.kindDays,
                keys: dataset.kindDays
                    .map((days, bucket) => ({ bucket, label: activityLabel(bucket), days }))
                    .filter((k) => k.days > 0)
                    .sort((a, b) => b.days - a.days),
            };
        }

        if (colorMode === 'origin') {
            const { clusters, byTrack, hasElsewhere } = clusterOrigins(tracks);
            return {
                count: Math.max(1, clusters.length),
                rgb: clusters.map((_, i) => categoryRgb(i, clusters.length, hasElsewhere)),
                at: (ti) => byTrack[ti],
                days: clusters.map((c) => c.days),
                keys: clusters.map((c, bucket) => ({ bucket, label: c.label, days: c.days })),
            };
        }

        const r = dateRange;
        const of = new Uint8Array(tracks.length);
        const days = new Array<number>(DATE_BUCKETS).fill(0);
        for (let i = 0; i < tracks.length; i++) {
            const f =
                r && r.hiMs > r.loMs ? (dayMs(tracks[i].day) - r.loMs) / (r.hiMs - r.loMs) : 0;
            const b = Math.max(0, Math.min(DATE_BUCKETS - 1, Math.round(f * (DATE_BUCKETS - 1))));
            of[i] = b;
            days[b] += 1;
        }
        return {
            count: DATE_BUCKETS,
            rgb: DATE_RGB,
            at: (ti) => of[ti],
            days,
            // A continuous scale has no entries to click; the gradient below the
            // plot is its legend.
            keys: null,
        };
    });

    /**
     * Ink per day. A thousand overlaid days at any usable per-day opacity is a
     * solid block, so the alpha falls with the count and the picture reads as
     * density: where many days went, the strand is bright.
     *
     * It follows the days actually on screen, so isolating twenty flights out of
     * two thousand days does not leave them at an opacity meant for the crowd.
     * The brightness therefore does change when the legend filters — but it is
     * the same function of the same count either way, so lifting the filter puts
     * the picture back exactly as it was, not approximately.
     */
    const INK = 2.5;
    function alphaFor(): number {
        const days = isolate === null ? dataset.tracks.length : (buckets.days[isolate] ?? 1);
        return Math.max(0.09, Math.min(0.6, INK / Math.sqrt(Math.max(1, days))));
    }

    /* ------------------------------------------------------- retained traces */

    /**
     * The traces, built once as geometry in metre space and bucketed by clock
     * slice. Nothing here is ever rebuilt for a change of view *or* a change of
     * time — the clock only selects how many slices get stroked.
     *
     * Three things fall out of it. A zoom or a pan is one `setTransform`: the
     * paths are already in the coordinates the data is in, so the few hundred
     * thousand JS path commands a repaint used to cost, on every wheel tick, are
     * simply not there. A scrub is the same — dragging the handle picks a
     * different number of slices, forward or backward, and never walks a
     * keyframe. And the slicing is what keeps the still picture honest: canvas
     * composites a `stroke()` as one shape, so overlaps *inside* a path do not
     * build up. Replaying a whole year in one stroke came out flat, nothing like
     * the picture playback had accumulated. Stroke slice by slice and the result
     * stops depending on how you arrived at it — filter the legend and unfilter
     * it, and you are back exactly where you started.
     *
     * The price is one pass over every keyframe when the section first opens,
     * which is the pass a single scrub used to cost.
     */
    const SLICES = 720;
    /**
     * Minutes per slice, from the clock's own length rather than fixed: an
     * activity plot's clock can be an hour where a day plot's is twenty-four,
     * and the compositing grain should be the same fraction of either.
     */
    const sliceMin = $derived(span / SLICES);
    const sliceOf = (t: number) => Math.max(0, Math.min(SLICES - 1, Math.floor(t / sliceMin)));

    let slicePaths: Array<Array<Path2D | undefined>> = [];
    let sliceUsed: Uint8Array[] = [];
    /** How many slices are currently inked onto the accumulating canvas. */
    let drawnSlices = 0;

    function clearPaths() {
        drawnSlices = 0;
        const n = buckets.count;
        // Path2Ds are created on first use: a date ramp is two dozen buckets
        // over seven hundred slices, and all but a handful of those pairs are
        // empty on any real dataset.
        slicePaths = Array.from({ length: SLICES }, () => new Array(n));
        sliceUsed = Array.from({ length: SLICES }, () => new Uint8Array(n));
    }

    /**
     * Walk one day's keyframes over `[from, to]` into whichever path `pick`
     * hands back for each leg, clipping the first and last to the window.
     *
     * `pick` returning null drops the leg and lifts the pen, which is how the
     * overlay skips a filtered-out activity without joining across it. So does a
     * tracking gap: a held position is somewhere the day never walked to, and
     * joining it to where it reappears draws a line across a city.
     */
    function emitSegments(
        tr: RelativeTrack,
        from: number,
        to: number,
        bucketAt: (segIndex: number) => number,
        pick: (t0: number, bucket: number) => Path2D | null
    ) {
        const { times, xs, ys, gapAfter } = tr;
        const n = times.length;
        let open: Path2D | null = null;
        for (let i = 0; i < n - 1; i++) {
            const t0 = times[i];
            const t1 = times[i + 1];
            if (t1 <= from) continue;
            if (t0 >= to) break;
            if (gapAfter[i] === 1) {
                open = null;
                continue;
            }
            const path = pick(t0, bucketAt(i));
            if (!path) {
                open = null;
                continue;
            }
            const span = t1 - t0;
            const fa = span > 0 ? Math.max(0, (from - t0) / span) : 0;
            const fb = span > 0 ? Math.min(1, (to - t0) / span) : 1;
            const dx = xs[i + 1] - xs[i];
            const dy = ys[i + 1] - ys[i];
            // A different path object — a new slice, a new activity — means the
            // pen has to be put down again, as does a leg clipped at its start.
            if (path !== open || fa > 0) {
                path.moveTo(xs[i] + dx * fa, ys[i] + dy * fa);
                open = path;
            }
            path.lineTo(xs[i] + dx * fb, ys[i] + dy * fb);
            if (fb < 1) open = null;
        }
    }

    const pickSlice = (t0: number, bucket: number) => {
        const s = sliceOf(t0);
        sliceUsed[s][bucket] = 1;
        return (slicePaths[s][bucket] ??= new Path2D());
    };

    /** Build the whole day, every day, into the slice cache. */
    function buildPaths() {
        clearPaths();
        const tracks = dataset.tracks;
        const at = buckets.at;
        for (let ti = 0; ti < tracks.length; ti++) {
            emitSegments(tracks[ti], 0, span, (si) => at(ti, si), pickSlice);
        }
    }

    /* ---------------------------------------------------------------- paint */

    /** A theme token as a canvas-usable colour. */
    function token(name: string, alpha = 1): string {
        if (typeof document === 'undefined') return '#888';
        const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        if (!raw) return '#888';
        return alpha >= 1 ? `hsl(${raw})` : `hsl(${raw} / ${alpha})`;
    }

    const rgba = (bucket: number, alpha: number): string => {
        const [r, g, b] = buckets.rgb[bucket] ?? ACTIVITY_RGB[ACTIVITY_OTHER];
        return `rgba(${r},${g},${b},${alpha})`;
    };

    /** A round distance for the rings: 1, 2 or 5 × a power of ten, in metres. */
    function ringStep(spanM: number): number {
        const raw = spanM / 3.5;
        const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
        for (const m of [1, 2, 5]) if (raw <= m * pow) return m * pow;
        return 10 * pow;
    }

    const formatDistance = (m: number) =>
        m >= 1000 ? `${(m / 1000).toLocaleString()} km` : `${Math.round(m)} m`;

    /** The distance rings, in screen space so the labels stay upright. */
    function drawRings(ctx: CanvasRenderingContext2D) {
        // Far enough out to cover the corner the origin is furthest from.
        const cx = sx(0);
        const cy = sy(0);
        const reachPx = Math.max(
            Math.hypot(cx, cy),
            Math.hypot(cssWidth - cx, cy),
            Math.hypot(cx, cssHeight - cy),
            Math.hypot(cssWidth - cx, cssHeight - cy)
        );
        const step = ringStep(reachPx / pxPerM);

        ctx.save();
        ctx.strokeStyle = token('--border');
        ctx.fillStyle = token('--muted-foreground');
        ctx.lineWidth = 1;
        // The tick face of every chart, resolved off the root: a canvas does not
        // read var().
        ctx.font = chartFont();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (let r = step; r * pxPerM <= reachPx; r += step) {
            const rp = r * pxPerM;
            ctx.beginPath();
            ctx.arc(cx, cy, rp, 0, Math.PI * 2);
            ctx.stroke();
            // On the ring itself, up and to the right of centre: the one place
            // a label cannot be mistaken for part of a trace.
            const lx = cx + rp * Math.SQRT1_2;
            const ly = cy - rp * Math.SQRT1_2;
            if (lx > 0 && lx < cssWidth - 40 && ly > 8 && ly < cssHeight - 8) {
                ctx.fillText(formatDistance(r), lx + 4, ly - 6);
            }
        }
        ctx.restore();
    }

    /** Ink slices `[drawnSlices, upTo)` onto the accumulating canvas. */
    function commitSlices(upTo: number) {
        const ctx = trailCtx;
        if (!ctx || upTo <= drawnSlices) return;
        dataSpace(ctx);
        const alpha = alphaFor();
        for (let s = drawnSlices; s < upTo; s++) {
            const used = sliceUsed[s];
            if (!used) continue;
            for (let k = 0; k < used.length; k++) {
                const path = slicePaths[s][k];
                if (!used[k] || !path) continue;
                if (isolate !== null && k !== isolate) continue;
                ctx.strokeStyle = rgba(k, alpha);
                ctx.stroke(path);
            }
        }
        screenSpace(ctx);
        drawnSlices = upTo;
    }

    /** The whole picture as of the current clock, straight from the cache. */
    function redraw() {
        const ctx = trailCtx;
        if (!ctx) return;
        screenSpace(ctx);
        ctx.clearRect(0, 0, cssWidth, cssHeight);
        drawRings(ctx);
        drawnSlices = 0;
        commitSlices(sliceOf(clockMin));
        paintOverlay();
    }

    /**
     * Catch the canvas up to the clock.
     *
     * Forward — playing, or dragging the handle to the right — is additive: ink
     * the slices that have gone by. Backwards there is no way to take ink off a
     * canvas, so the picture is laid down again from the cache, which costs
     * about what a zoom does.
     */
    function syncToClock() {
        const want = sliceOf(clockMin);
        if (want >= drawnSlices) {
            commitSlices(want);
            paintOverlay();
        } else {
            redraw();
        }
    }

    /**
     * The overlay: the slice in progress, and the moving heads.
     *
     * The part-slice lives here rather than on the accumulating canvas so that
     * canvas only ever holds whole slices, each stroked exactly once. This one
     * is wiped and redrawn every frame, so nothing here is composited twice
     * either — and it is what keeps the trace's tip exactly under its head
     * instead of up to two clock-minutes behind it.
     */
    function paintOverlay() {
        const ctx = headCtx;
        const tracks = dataset.tracks;
        if (!ctx) return;
        screenSpace(ctx);
        ctx.clearRect(0, 0, cssWidth, cssHeight);
        if (!tracks.length) return;

        sampleHeads(tracks, clockMin, xy, headSeg, aliveBuf);

        const from = drawnSlices * sliceMin;
        if (clockMin > from) {
            const partial = new Array<Path2D | undefined>(buckets.count);
            const used = new Uint8Array(buckets.count);
            const pick = (_t0: number, bucket: number) => {
                if (isolate !== null && bucket !== isolate) return null;
                used[bucket] = 1;
                return (partial[bucket] ??= new Path2D());
            };
            const at = buckets.at;
            for (let ti = 0; ti < tracks.length; ti++) {
                emitSegments(tracks[ti], from, clockMin, (si) => at(ti, si), pick);
            }

            dataSpace(ctx);
            const alpha = alphaFor();
            for (let k = 0; k < used.length; k++) {
                const path = partial[k];
                if (!used[k] || !path) continue;
                ctx.strokeStyle = rgba(k, alpha);
                ctx.stroke(path);
            }
            screenSpace(ctx);
        }

        const heads = new Array<Path2D | undefined>(buckets.count);
        const at = buckets.at;
        let any = false;
        for (let i = 0; i < tracks.length; i++) {
            if (!aliveBuf[i]) continue;
            const k = at(i, headSeg[i]);
            if (isolate !== null && k !== isolate) continue;
            const path = (heads[k] ??= new Path2D());
            path.moveTo(sx(xy[i * 2]) + 1.6, sy(xy[i * 2 + 1]));
            path.arc(sx(xy[i * 2]), sy(xy[i * 2 + 1]), 1.6, 0, Math.PI * 2);
            any = true;
        }
        if (!any) return;
        for (let k = 0; k < heads.length; k++) {
            const path = heads[k];
            if (!path) continue;
            ctx.fillStyle = rgba(k, 0.85);
            ctx.fill(path);
        }
    }

    /* ------------------------------------------------------------ lifecycle */

    function resizeBuffers() {
        const n = dataset.tracks.length;
        if (xy.length === n * 2) return;
        xy = new Float32Array(n * 2);
        headSeg = new Int32Array(n);
        aliveBuf = new Uint8Array(n);
    }

    function sizeCanvas(canvas: HTMLCanvasElement | null) {
        if (!canvas) return null;
        canvas.width = Math.max(1, Math.round(cssWidth * dpr));
        canvas.height = Math.max(1, Math.round(cssHeight * dpr));
        const ctx = canvas.getContext('2d');
        ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
        return ctx;
    }

    function measure() {
        if (!shell) return;
        dpr = Math.min(2, window.devicePixelRatio || 1);
        // Both from the element, never one measured and the other assumed. The
        // stage is styled to HEIGHT, but it carries a 1px border, so its inside
        // is two pixels shorter — and the canvases are stretched to that inside
        // by `height: 100%`. Taking HEIGHT here made the drawing model that bit
        // taller than the box showing it, and every trace was squashed by the
        // difference. Invisible, because both layers were squashed alike, and
        // wrong all the same.
        cssWidth = shell.clientWidth;
        cssHeight = shell.clientHeight;
        trailCtx = sizeCanvas(trailCanvas);
        headCtx = sizeCanvas(headCanvas);
    }

    /** The scale at which the 98th-percentile reach just fills the frame. */
    function fitScale(): number {
        const half = Math.min(cssWidth, cssHeight) / 2;
        return (half * FIT_FRACTION) / Math.max(1, dataset.reachM);
    }

    /** Frame that reach, centred. Both views, so no gesture survives it. */
    function fit() {
        pxPerM = fitScale();
        panX = 0;
        panY = 0;
        syncView();
    }

    /** Put the asked-for view back on the rasterised one. */
    function syncView() {
        viewPxPerM = pxPerM;
        viewPanX = panX;
        viewPanY = panY;
        if (trailCanvas) trailCanvas.style.transform = '';
        if (headCanvas) headCanvas.style.transform = '';
    }

    let frameQueued = 0;
    let needsRebuild = false;

    /**
     * Fold every pending view change into one repaint on the next frame.
     *
     * A wheel gesture fires events faster than a canvas this size can be
     * painted. Painting per event means each one starts a repaint of a view the
     * pointer has already left, the queue never drains, and the whole component
     * locks up — which is what "the zoom is slow" actually was, more than the
     * cost of any single paint.
     */
    function invalidate(rebuild = false) {
        needsRebuild ||= rebuild;
        if (frameQueued) return;
        frameQueued = requestAnimationFrame(() => {
            frameQueued = 0;
            resizeBuffers();
            if (needsRebuild) {
                needsRebuild = false;
                buildPaths();
            }
            redraw();
        });
    }

    /* ------------------------------------------------------------- gestures */

    /**
     * How long the pointer has to be still before the view is rasterised again.
     *
     * The whole gesture runs on the compositor until then. This is not about
     * saving work — it is what keeps the *main thread free*, and that turns out
     * to be the difference between a zoom that works and one that fights the
     * page. A `wheel` handler that calls `preventDefault` has to be non-passive,
     * so the browser must wait for the main thread before it knows whether the
     * page is allowed to scroll; when the thread is busy rasterising half a
     * million line segments it does not answer in time, the compositor gives up
     * waiting and scrolls anyway, and the queued wheel events then land as a
     * zoom once the thread frees up. The page moves *and* the plot zooms, both
     * half-way. Keeping the thread idle during the gesture is the fix.
     */
    const COMMIT_DELAY_MS = 90;

    let gestureRaf = 0;
    let commitTimer: ReturnType<typeof setTimeout> | 0 = 0;

    /**
     * Show the asked-for view by transforming the pixels already on the canvas.
     *
     * Exact rather than approximate: the committed rendering puts the origin at
     * `C` and a point `q` metres away at `C + k·q`; the asked-for view wants
     * `P + s·k·q`. A translate of `P − s·C` followed by a scale of `s` maps one
     * onto the other for every `q`, so nothing shifts relative to anything else
     * — the image is only ever the right picture at the wrong resolution, for
     * the fraction of a second before it is drawn again.
     */
    function applyGestureTransform() {
        const s = viewPxPerM / pxPerM;
        const tx = cssWidth / 2 + viewPanX - s * (cssWidth / 2 + panX);
        const ty = cssHeight / 2 + viewPanY - s * (cssHeight / 2 + panY);
        const css =
            s === 1 && tx === 0 && ty === 0 ? '' : `translate(${tx}px, ${ty}px) scale(${s})`;
        if (trailCanvas) trailCanvas.style.transform = css;
        if (headCanvas) headCanvas.style.transform = css;
    }

    /** Rasterise at the asked-for view and drop the stand-in transform. */
    function commitView() {
        if (commitTimer) {
            clearTimeout(commitTimer);
            commitTimer = 0;
        }
        if (pxPerM === viewPxPerM && panX === viewPanX && panY === viewPanY) return;
        pxPerM = viewPxPerM;
        panX = viewPanX;
        panY = viewPanY;
        // Painted here and not through `invalidate`, so the transform is cleared
        // in the same turn as the repaint that makes it unnecessary. A frame
        // between the two would show the picture snap back and forth.
        resizeBuffers();
        redraw();
        if (trailCanvas) trailCanvas.style.transform = '';
        if (headCanvas) headCanvas.style.transform = '';
    }

    /** The view moved: show it now, draw it properly once the pointer settles. */
    function nudgeView() {
        if (!gestureRaf) {
            gestureRaf = requestAnimationFrame(() => {
                gestureRaf = 0;
                applyGestureTransform();
            });
        }
        if (commitTimer) clearTimeout(commitTimer);
        commitTimer = setTimeout(commitView, COMMIT_DELAY_MS);
    }

    function zoomAbout(px: number, py: number, factor: number) {
        const f = fitScale();
        const next = Math.min(f * ZOOM_RANGE[1], Math.max(f * ZOOM_RANGE[0], viewPxPerM * factor));
        if (next === viewPxPerM) return;
        // Keep whatever sits under the cursor exactly where it is.
        const mx = (px - cssWidth / 2 - viewPanX) / viewPxPerM;
        const my = -(py - cssHeight / 2 - viewPanY) / viewPxPerM;
        viewPxPerM = next;
        viewPanX = px - cssWidth / 2 - mx * viewPxPerM;
        viewPanY = py - cssHeight / 2 + my * viewPxPerM;
        nudgeView();
    }

    function onWheel(e: WheelEvent) {
        e.preventDefault();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        zoomAbout(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.002));
    }

    let dragging = $state(false);
    let dragX = 0;
    let dragY = 0;

    function onPointerDown(e: PointerEvent) {
        dragging = true;
        dragX = e.clientX;
        dragY = e.clientY;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: PointerEvent) {
        if (!dragging) return;
        viewPanX += e.clientX - dragX;
        viewPanY += e.clientY - dragY;
        dragX = e.clientX;
        dragY = e.clientY;
        nudgeView();
    }

    function onPointerUp(e: PointerEvent) {
        if (!dragging) return;
        dragging = false;
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        // A finished drag is exactly when a repaint is welcome.
        commitView();
    }

    /* -------------------------------------------------------------- playback */

    let rafId = 0;
    let lastTs = 0;
    /** While set, the finished day is being held on screen before the wipe. */
    let holdUntil = 0;
    const LOOP_HOLD_MS = 1500;

    function frame(ts: number) {
        if (!playing) {
            rafId = 0;
            return;
        }
        const dt = lastTs ? ts - lastTs : 0;
        lastTs = ts;

        if (holdUntil) {
            // The completed picture is the whole payoff of accumulating ink, and
            // looping straight through it would wipe it in the frame it was
            // finished. So it stays up for a beat first.
            if (ts < holdUntil) {
                rafId = requestAnimationFrame(frame);
                return;
            }
            holdUntil = 0;
            clockMin = 0;
        } else {
            // The playhead advances evenly; the clock follows it through
            // whatever gearing this dataset has.
            const p = progress + (Math.min(dt, 100) / PLAY_MS) * speed;
            if (p >= 1) {
                clockMin = span;
                holdUntil = ts + LOOP_HOLD_MS;
            } else {
                clockMin = clockAt(p, span, knee);
            }
        }
        syncToClock();
        rafId = requestAnimationFrame(frame);
    }

    function togglePlay() {
        playing = !playing;
        if (playing) {
            lastTs = 0;
            holdUntil = 0;
            if (clockMin >= span) clockMin = 0;
            rafId = requestAnimationFrame(frame);
        }
    }

    function scrub(to: number) {
        if (playing) playing = false;
        holdUntil = 0;
        clockMin = clockAt(to, span, knee);
        invalidate();
    }

    /* ---------------------------------------------------------------- export */

    /**
     * The clock, compressed into something shareable.
     *
     * On screen a full pass takes three minutes at 1×, which is the right pace
     * for watching ink accumulate and the wrong length for a file anyone will
     * send to someone. Twelve seconds keeps the build legible — the picture is
     * still assembled in front of you — without asking for a third of an hour
     * of attention. The speed buttons then divide it, so the control that
     * hurries the chart on screen hurries the file too.
     */
    const EXPORT_BASE_MS = 12_000;
    const EXPORT_MS = $derived(clipDurationMs(EXPORT_BASE_MS, speed));

    /** Where the reader had left the clock, restored after a recording. */
    let clockBeforeExport = 0;
    let playingBeforeExport = false;

    const shareSource = $derived<ShareSource>({
        name: 'relative-traces',
        title: 'Every outing, from one spot',
        element: () => shell,
        animation: {
            durationMs: EXPORT_MS,
            speed,
            begin: () => {
                playingBeforeExport = playing;
                playing = false;
                holdUntil = 0;
                clockBeforeExport = clockMin;
            },
            end: () => {
                clockMin = clockBeforeExport;
                // Rewinding is the one direction the accumulating canvas cannot
                // do incrementally, so the picture is laid down again.
                redraw();
                if (playingBeforeExport) togglePlay();
            },
            seek: (t) => {
                clockMin = clockAt(t, span, knee);
                syncToClock();
            },
        },
    });

    onMount(() => {
        // Nothing is drawn until the section is on screen: building the picture
        // walks every keyframe of every day, and most visitors never scroll here.
        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries[0].isIntersecting) return;
                visible = true;
                observer.disconnect();
            },
            { threshold: 0.05 }
        );
        if (shell) observer.observe(shell);

        const ro = new ResizeObserver(() => {
            if (!visible) return;
            measure();
            // The stand-in transform is expressed in pixels of the old box.
            syncView();
            invalidate();
        });
        if (shell) ro.observe(shell);

        // Bound by hand rather than as an attribute so the listener is
        // explicitly non-passive: the handler cancels the page scroll.
        shell?.addEventListener('wheel', onWheel, { passive: false });

        return () => {
            observer.disconnect();
            ro.disconnect();
            shell?.removeEventListener('wheel', onWheel);
        };
    });

    onDestroy(() => {
        if (rafId) cancelAnimationFrame(rafId);
        if (frameQueued) cancelAnimationFrame(frameQueued);
        if (gestureRaf) cancelAnimationFrame(gestureRaf);
        if (commitTimer) clearTimeout(commitTimer);
    });

    // A dataset can lose its labelled activities — a Timeline import replacing a
    // Garmin one — and the mode's button goes with them, which would leave the
    // plot in a mode with nothing selected to say so.
    $effect(() => {
        if (colorMode === 'activity' && !hasActivities) {
            colorMode = 'date';
            isolate = null;
            untrack(() => invalidate(true));
        }
    });

    /**
     * Start over on a new dataset, on a theme swap (which recolours the rings),
     * and on first becoming visible.
     *
     * The painting is untracked on purpose. It reads the clock, the isolated
     * kind and the scale, and it writes the first two — tracked, this would be
     * an effect that retriggers itself, and every scrub or legend click would
     * reset the view it was meant to update.
     */
    $effect(() => {
        void dataset;
        void themeStore.theme;
        const on = visible;
        untrack(() => {
            if (!on) return;
            playing = false;
            holdUntil = 0;
            clockMin = 0;
            measure();
            fit();
            invalidate(true);
        });
    });
</script>

<div class="trace-race">
    <div class="controls">
        <button
            type="button"
            class="race-btn"
            aria-pressed={playing}
            onclick={() => {
                trackControl('relative-trace-race', 'playback', playing ? 'pause' : 'play');
                togglePlay();
            }}
        >
            {playing ? 'Pause' : 'Play'}
        </button>

        <div class="speeds" role="group" aria-label="Playback speed">
            {#each SPEEDS as s (s)}
                <button
                    type="button"
                    class="race-btn speed"
                    class:active={speed === s}
                    aria-pressed={speed === s}
                    onclick={() => {
                        trackControl('relative-trace-race', 'speed', String(s));
                        speed = s;
                    }}
                >
                    {s}×
                </button>
            {/each}
        </div>

        <div class="speeds" role="group" aria-label="Zoom">
            <button
                type="button"
                class="race-btn speed"
                aria-label="Zoom out"
                onclick={() => {
                    trackControl('relative-trace-race', 'zoom', 'out');
                    zoomAbout(cssWidth / 2, cssHeight / 2, 1 / ZOOM_STEP);
                    commitView();
                }}
            >
                −
            </button>
            <button
                type="button"
                class="race-btn speed"
                aria-label="Zoom in"
                onclick={() => {
                    trackControl('relative-trace-race', 'zoom', 'in');
                    zoomAbout(cssWidth / 2, cssHeight / 2, ZOOM_STEP);
                    commitView();
                }}
            >
                +
            </button>
            <button
                type="button"
                class="race-btn speed"
                onclick={() => {
                    trackControl('relative-trace-race', 'zoom', 'fit');
                    fit();
                    invalidate();
                }}
            >
                Fit
            </button>
        </div>

        <div class="speeds" role="group" aria-label="Colour by">
            {#each COLOR_MODES as m (m.key)}
                {#if m.key !== 'activity' || hasActivities}
                    <button
                        type="button"
                        class="race-btn speed"
                        class:active={colorMode === m.key}
                        aria-pressed={colorMode === m.key}
                        onclick={() => {
                            if (colorMode === m.key) return;
                            trackControl('relative-trace-race', 'color-mode', m.key);
                            colorMode = m.key;
                            // The cache is partitioned by colour bucket, so a new
                            // question means the traces are filed again.
                            isolate = null;
                            invalidate(true);
                        }}
                    >
                        {m.label}
                    </button>
                {/if}
            {/each}
        </div>

        <span class="spacer"></span>
        <span class="clock">{clockLabel}</span>
        <ShareMenu source={shareSource} vizId="relative-trace-race" floating={false} />
    </div>

    <!--
        The handle runs on the playhead, not on the clock, so the gearing is the
        same whether you drag it or let it play. The tick marks where the gear
        changes, since a bar that quietly speeds up and says nothing about it is
        a bar that lies about how long things took.
    -->
    <div class="track">
        <input
            type="range"
            class="race-scrubber"
            min="0"
            max="1"
            step="0.001"
            value={progress}
            oninput={(e) => {
                trackControl('relative-trace-race', 'scrub', 'drag');
                scrub(+e.currentTarget.value);
            }}
            aria-label={dataset.timeBase === 'elapsed'
                ? 'Time since each outing started'
                : 'Time of day'}
            aria-valuetext={clockLabel}
            style={`--progress:${progress * 100}%`}
        />
        {#if kneePct !== null}
            <span
                class="knee"
                style:left={`${kneePct}%`}
                title={`Past ${kneeLabel}, the clock runs faster`}
            ></span>
        {/if}
    </div>

    <!--
        Drag to pan, wheel to zoom. Not a focusable control: everything it does
        is also on a button above it, so it stays out of the tab order rather
        than trapping a keyboard user in a canvas.
    -->
    <div
        bind:this={shell}
        class="stage"
        style:height={`${HEIGHT}px`}
        class:dragging
        role="img"
        aria-label="Every tracked day drawn from a shared origin"
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={onPointerUp}
    >
        <canvas bind:this={trailCanvas} class="layer"></canvas>
        <canvas bind:this={headCanvas} class="layer"></canvas>
    </div>

    <div class="footer">
        {#if buckets.keys}
            <div class="legend">
                {#each buckets.keys as k (k.bucket)}
                    <button
                        type="button"
                        class="key"
                        class:dimmed={isolate !== null && isolate !== k.bucket}
                        aria-pressed={isolate === k.bucket}
                        onclick={() => {
                            const next = isolate === k.bucket ? null : k.bucket;
                            trackControl(
                                'relative-trace-race',
                                'isolate',
                                next === null ? 'all' : String(next)
                            );
                            isolate = next;
                            invalidate();
                        }}
                    >
                        <span class="swatch" style:background={swatch(k.bucket)}></span>
                        {k.label}
                        <span class="count">{k.days.toLocaleString()}</span>
                    </button>
                {/each}
            </div>
        {:else if dateRange}
            <div class="ramp">
                <span class="count">{fmtMonthYear(dateRange.lo)}</span>
                <span class="ramp-bar" style:background={DATE_GRADIENT}></span>
                <span class="count">{fmtMonthYear(dateRange.hi)}</span>
            </div>
        {/if}
        <p class="caption">
            {dataset.tracks.length.toLocaleString()}
            {mode === 'activities' ? 'outings' : 'days'}, all starting at the centre — drag to pan,
            scroll to zoom.
        </p>
    </div>
</div>

<style>
    .trace-race {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .controls {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        flex-wrap: wrap;
    }

    .speeds {
        display: flex;
        gap: 0.3rem;
    }

    .spacer {
        flex: 1;
    }

    .clock {
        font-size: var(--text-body);
        color: hsl(var(--foreground));
        font-variant-numeric: tabular-nums;
    }

    .stage {
        position: relative;
        width: 100%;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-md);
        overflow: hidden;
        background: hsl(var(--card));
        cursor: grab;
        touch-action: none;
        /* Nothing that happens in here should reach the page behind it. */
        overscroll-behavior: contain;
    }

    .stage.dragging {
        cursor: grabbing;
    }

    .layer {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        /* The gesture transform is derived against this origin, and the hint
           keeps the layers off the main thread while it is applied. */
        transform-origin: 0 0;
        will-change: transform;
    }

    .footer {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
    }

    .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 0.3rem;
    }

    /* Clicking a kind isolates it. With six categories the palette cannot be
       made safe for every kind of colour vision at once, so this is the channel
       that actually answers "which of these two is which". */
    .key {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.25rem 0.6rem;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-pill);
        font-size: var(--text-small);
        color: hsl(var(--foreground));
        cursor: pointer;
        transition:
            opacity 0.15s,
            border-color 0.15s;
    }

    .key:hover {
        border-color: hsl(var(--foreground) / 0.4);
    }

    .key.dimmed {
        opacity: 0.4;
    }

    .ramp {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-width: 14rem;
        flex: 1;
    }

    .ramp-bar {
        flex: 1;
        height: 8px;
        border-radius: var(--radius-pill);
        border: 1px solid hsl(var(--border));
    }

    .swatch {
        width: 0.6rem;
        height: 0.6rem;
        border-radius: 2px;
        flex: none;
    }

    .count {
        color: hsl(var(--muted-foreground));
        font-variant-numeric: tabular-nums;
    }

    .caption {
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
        margin: 0;
    }

    .race-btn {
        border: 1px solid hsl(var(--border));
        background: hsl(var(--secondary) / 0.45);
        color: hsl(var(--foreground));
        border-radius: var(--radius-pill);
        padding: 0.35rem 0.85rem;
        font-size: var(--text-body);
        cursor: pointer;
        transition:
            border-color 0.15s,
            background-color 0.15s;
    }

    .race-btn:hover {
        border-color: hsl(var(--foreground) / 0.4);
    }

    .race-btn.speed {
        padding: 0.3rem 0.65rem;
        font-size: var(--text-small);
        color: hsl(var(--muted-foreground));
        font-variant-numeric: tabular-nums;
    }

    .race-btn.speed.active {
        border-color: hsl(var(--foreground) / 0.45);
        background: hsl(var(--secondary));
        color: hsl(var(--foreground));
        font-weight: 600;
    }

    .track {
        position: relative;
        display: flex;
        align-items: center;
    }

    /* Where the clock changes gear. */
    .knee {
        position: absolute;
        top: 50%;
        width: 2px;
        height: 12px;
        margin-left: -1px;
        transform: translateY(-50%);
        border-radius: 1px;
        background: hsl(var(--muted-foreground) / 0.8);
        pointer-events: none;
    }

    .race-scrubber {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        height: 4px;
        border-radius: var(--radius-pill);
        background: linear-gradient(
            to right,
            hsl(var(--foreground) / 0.7) var(--progress, 0%),
            hsl(var(--border)) var(--progress, 0%)
        );
        cursor: pointer;
        outline: none;
    }

    .race-scrubber::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 13px;
        height: 13px;
        border-radius: 50%;
        background: hsl(var(--foreground));
        box-shadow: 0 0 0 3px hsl(var(--card));
        transition: transform 0.12s ease;
    }

    .race-scrubber::-moz-range-thumb {
        width: 13px;
        height: 13px;
        border: none;
        border-radius: 50%;
        background: hsl(var(--foreground));
        box-shadow: 0 0 0 3px hsl(var(--card));
    }

    .race-scrubber:hover::-webkit-slider-thumb,
    .race-scrubber:active::-webkit-slider-thumb {
        transform: scale(1.18);
    }
</style>
