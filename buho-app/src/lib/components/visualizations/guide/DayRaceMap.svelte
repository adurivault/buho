<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import type { Map as MaplibreMap, IControl } from 'maplibre-gl';
    import type { MapboxOverlay } from '@deck.gl/mapbox';
    import { loadMaplibre } from '#lib/visualizations/maplibre.ts';
    import type { DayRecord, DayRaceSegmentRows } from '#lib/data/queries/positionsQueries.ts';
    import {
        buildDayRaceDataset,
        sampleDots,
        sampleSources,
        sampleTrails,
        dayOfYearFraction,
        DAY_MINUTES,
        TRAIL_MAX_SEG,
    } from '#lib/visualizations/dayRaceData.ts';
    import { interpolateTurbo, rgb } from 'd3';
    import { themeStore, type Theme } from '#lib/stores/themeStore.svelte.ts';
    import { hexToRgb, peakColor } from '#lib/visualizations/themeColors.ts';
    import { categoricalColor } from '#lib/utils/dimensionColors.ts';
    import { trackControl } from '#lib/analytics.ts';
    import ShareMenu from '#lib/components/ShareMenu.svelte';
    import { clipDurationMs, type ShareSource } from '#lib/export/index.ts';

    interface Props {
        days: DayRecord[];
        segments: DayRaceSegmentRows;
    }

    let { days, segments }: Props = $props();

    const SEG_COUNT = TRAIL_MAX_SEG;
    // Phone-recorded days in the positions peak, as the theme paints it; the
    // watch in an unrelated categorical hue, so the two sources tell apart.
    const DOT_RGB = $derived.by(() => {
        void themeStore.theme;
        return hexToRgb(peakColor('positions'));
    });
    const GARMIN_RGB = $derived(hexToRgb(categoricalColor(6)));
    // Dots are translucent so overlapping days accumulate into brighter spots.
    const DOT_ALPHA = 90;
    // Full day (1440 clock-minutes) plays in 90 s at 1×. 1× is a *slow* setting
    // on purpose — it is the one where a single day can be followed by eye —
    // and the ceiling is high enough to cross a decade of days in one sitting.
    const MIN_PER_MS = DAY_MINUTES / 90000;
    const SPEEDS = [1, 2, 4, 8, 16] as const;
    // source: which provider recorded the day. flat: one colour for every day —
    // the provider's own, so a watch-only import is blue rather than painted in
    // Google's red. doy: position in the year (Jan 1 → Dec 31). date: position
    // across the whole timeline (earliest → latest day).
    type ColorMode = 'source' | 'flat' | 'doy' | 'date';
    const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
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
    // Static Turbo gradient (as CSS) for the visual colour scale.
    const TURBO_GRADIENT = (() => {
        const stops: string[] = [];
        const N = 16;
        for (let i = 0; i <= N; i++) {
            const f = i / N;
            stops.push(`${interpolateTurbo(f)} ${Math.round(f * 100)}%`);
        }
        return `linear-gradient(to right, ${stops.join(', ')})`;
    })();

    // The classic (full) OpenFreeMap basemap per theme — labels, streets and all.
    const STYLE_URL: Record<Theme, string> = {
        dark: 'https://tiles.openfreemap.org/styles/dark',
        light: 'https://tiles.openfreemap.org/styles/positron',
    };

    const pad = (n: number) => String(n).padStart(2, '0');

    // Every day at once — no city filter; the viewport is yours to pan/zoom.
    const dataset = $derived(buildDayRaceDataset(segments, days));

    // Timeline span of the animated days (tracks are already sorted by day).
    const dateRange = $derived.by(() => {
        const t = dataset.tracks;
        if (!t.length) return null;
        const lo = t[0].day;
        const hi = t[t.length - 1].day;
        return { lo, hi, loMs: dayMs(lo), hiMs: dayMs(hi) };
    });

    // Endpoint labels for the visual colour scale (null in flat-red mode).
    const scaleLabels = $derived.by(() => {
        if (colorMode === 'doy') return { lo: 'Jan', hi: 'Dec' };
        if (colorMode === 'date')
            return dateRange
                ? { lo: fmtMonthYear(dateRange.lo), hi: fmtMonthYear(dateRange.hi) }
                : null;
        return null;
    });

    /** Which providers the loaded days actually hold keyframes from. */
    const providers = $derived.by(() => {
        let garmin = false;
        let phone = false;
        for (const t of dataset.tracks) {
            for (let i = 0; i < t.garmin.length; i++) {
                if (t.garmin[i]) garmin = true;
                else phone = true;
                if (garmin && phone) return { garmin, phone };
            }
        }
        return { garmin, phone };
    });

    /**
     * Whether colouring by provider says anything. Without a Garmin import every
     * day is the phone's, and the mode would just be the flat colour under a
     * different name — as it would the other way round, with only the watch.
     */
    const hasBothSources = $derived(providers.garmin && providers.phone);

    /**
     * The one colour the flat mode paints with: whoever recorded the data.
     *
     * Google's red is the default because it is the app's accent for positions,
     * but a watch-only import has no Google in it, and painting it red says the
     * phone was there.
     */
    const flatRgb = $derived(providers.garmin && !providers.phone ? GARMIN_RGB : DOT_RGB);

    /** Days the watch recorded any part of, for the source legend. */
    const sourceCounts = $derived.by(() => {
        let garmin = 0;
        for (const t of dataset.tracks) {
            if (t.garmin.some((g) => g === 1)) garmin += 1;
        }
        return { garmin, phone: dataset.tracks.length - garmin };
    });

    let clockMin = $state(0);
    let playing = $state(false);
    let speed = $state<(typeof SPEEDS)[number]>(1);
    // Source by default: a day recorded by the watch moves at a completely
    // different resolution from one recorded by the phone, and colouring says
    // which you are looking at without having to guess from how it moves.
    let colorMode = $state<ColorMode>('source');
    let visible = $state(false);
    let ready = $state(false);

    const clockLabel = $derived.by(() => {
        const total = (4 * 60 + Math.floor(clockMin)) % DAY_MINUTES;
        return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
    });

    let container = $state<HTMLDivElement | null>(null);
    let map: MaplibreMap | null = null;
    let overlay: MapboxOverlay | null = null;
    let appliedTheme: Theme | null = null;
    let destroyed = false;

    let ScatterplotLayerCtor: (new (props: unknown) => unknown) | null = null;
    let LineLayerCtor: (new (props: unknown) => unknown) | null = null;

    // Per-frame deck.gl buffers, reallocated when the track count changes. The
    // trail colours are rewritten every frame (alpha depends on the clock);
    // `trackRgb` / `dotColors` change on a dataset or colour-mode switch, and
    // additionally every frame in source mode, where a dot's provider changes as
    // it crosses into and out of a recorded activity.
    let dotPositions = new Float32Array(0);
    let trailSrc = new Float32Array(0);
    let trailDst = new Float32Array(0);
    let trailColors: Uint8Array = new Uint8Array(0);
    let dotColors: Uint8Array = new Uint8Array(0);
    let trackRgb: Uint8Array = new Uint8Array(0);
    // Which provider each dot is currently moving on, resampled every frame in
    // source mode (precedence switches mid-day, so this cannot be fixed per day).
    let dotSources: Uint8Array = new Uint8Array(0);

    // Fraction 0→1 mapped onto the Turbo scale, per colour mode.
    function fractionFor(day: string): number {
        if (colorMode === 'doy') return dayOfYearFraction(day);
        const r = dateRange;
        if (!r || r.hiMs === r.loMs) return 0;
        return clamp01((dayMs(day) - r.loMs) / (r.hiMs - r.loMs));
    }

    // One RGB per track: by provider, flat red, or a continuous Turbo scale
    // (day-of-year or full-timeline date). Written into `trackRgb` / `dotColors`.
    function buildColors() {
        const tracks = dataset.tracks;
        const n = tracks.length;
        trackRgb = new Uint8Array(n * 3);
        dotColors = new Uint8Array(n * 4);
        const flat = colorMode === 'flat' || colorMode === 'source';
        for (let i = 0; i < n; i++) {
            let r = flatRgb[0];
            let g = flatRgb[1];
            let b = flatRgb[2];
            if (!flat) {
                const c = rgb(interpolateTurbo(fractionFor(tracks[i].day)));
                r = c.r;
                g = c.g;
                b = c.b;
            }
            trackRgb[i * 3] = r;
            trackRgb[i * 3 + 1] = g;
            trackRgb[i * 3 + 2] = b;
            dotColors[i * 4] = r;
            dotColors[i * 4 + 1] = g;
            dotColors[i * 4 + 2] = b;
            dotColors[i * 4 + 3] = DOT_ALPHA;
        }
    }

    function makeLayers(): unknown[] {
        const n = dataset.tracks.length;
        if (!n) return [];
        const layers: unknown[] = [];
        // Trail first so the dots paint over it. A fresh `data` wrapper each frame
        // forces deck.gl to re-upload the mutated typed arrays (stable refs).
        if (LineLayerCtor) {
            layers.push(
                new LineLayerCtor({
                    id: 'day-race-trails',
                    data: {
                        length: n * SEG_COUNT,
                        attributes: {
                            getSourcePosition: { value: trailSrc, size: 2 },
                            getTargetPosition: { value: trailDst, size: 2 },
                            getColor: { value: trailColors, size: 4 },
                        },
                    },
                    getWidth: 1.2,
                    widthUnits: 'pixels',
                    widthMinPixels: 1,
                    pickable: false,
                })
            );
        }
        if (ScatterplotLayerCtor) {
            layers.push(
                new ScatterplotLayerCtor({
                    id: 'day-race-dots',
                    data: {
                        length: n,
                        attributes: {
                            getPosition: { value: dotPositions, size: 2 },
                            getFillColor: { value: dotColors, size: 4 },
                        },
                    },
                    radiusUnits: 'pixels',
                    getRadius: 2.5,
                    radiusMinPixels: 1,
                    pickable: false,
                })
            );
        }
        return layers;
    }

    /**
     * Recolour the dots (and the trail palette behind them) from the provider
     * each one is currently moving on. Source mode only — every other mode fixes
     * its colours once in `buildColors`.
     */
    function applySourceColors() {
        const tracks = dataset.tracks;
        sampleSources(tracks, clockMin, dotSources);
        for (let i = 0; i < tracks.length; i++) {
            const [r, g, b] = dotSources[i] ? GARMIN_RGB : DOT_RGB;
            trackRgb[i * 3] = r;
            trackRgb[i * 3 + 1] = g;
            trackRgb[i * 3 + 2] = b;
            dotColors[i * 4] = r;
            dotColors[i * 4 + 1] = g;
            dotColors[i * 4 + 2] = b;
        }
    }

    function renderFrame() {
        if (!overlay) return;
        if (dataset.tracks.length) {
            sampleDots(dataset.tracks, clockMin, dotPositions);
            // Before the trails, which read `trackRgb`.
            if (colorMode === 'source') applySourceColors();
            sampleTrails(dataset.tracks, clockMin, trailSrc, trailDst, trailColors, trackRgb);
        }
        overlay.setProps({ layers: makeLayers() as never });
    }

    // Reallocate the position/trail buffers + refit whenever the animated set
    // changes (new upload). Runs during mount too, before the map is ready. The
    // colour effect (below) renders the frame once buffers are consistent.
    $effect(() => {
        const ds = dataset;
        const n = ds.tracks.length;
        dotPositions = new Float32Array(n * 2);
        dotSources = new Uint8Array(n);
        trailSrc = new Float32Array(n * SEG_COUNT * 2);
        trailDst = new Float32Array(n * SEG_COUNT * 2);
        trailColors = new Uint8Array(n * SEG_COUNT * 4);
        clockMin = 0;
        playing = false;
        if (map && ds.bounds) {
            map.fitBounds(ds.bounds, { padding: 24, animate: false });
        }
    });

    // Rebuild the per-track palette on a dataset or colour-mode change, then
    // render. Kept separate from the realloc effect so switching colours neither
    // resets the clock nor refits the map. Declared after it so, on a dataset
    // change, the buffers are already resized to a matching length here.
    $effect(() => {
        void dataset;
        void colorMode;
        buildColors();
        renderFrame();
    });

    // Colouring by provider is the default, but it means nothing with only one
    // of them loaded — and its button is hidden then, which would leave no mode
    // looking selected. Fall back to the flat colour that mode already renders as.
    $effect(() => {
        if (!hasBothSources && colorMode === 'source') colorMode = 'flat';
    });

    // rAF playback: advance the shared clock, stop at the end of the day.
    let rafId = 0;
    let lastTs = 0;
    function frame(ts: number) {
        if (!playing) {
            rafId = 0;
            return;
        }
        const dt = lastTs ? ts - lastTs : 0;
        lastTs = ts;
        clockMin += Math.min(dt, 100) * MIN_PER_MS * speed;
        // Loop: wrap back to 04:00 and keep playing (no replay needed).
        if (clockMin >= DAY_MINUTES) clockMin -= DAY_MINUTES;
        renderFrame();
        rafId = requestAnimationFrame(frame);
    }

    // Start/cancel the loop from the playback + visibility state. Pausing when
    // off-screen keeps rAF idle; scrolling back in resumes if still playing.
    $effect(() => {
        const go = playing && visible && ready && dataset.tracks.length > 0;
        if (go && !rafId) {
            lastTs = 0;
            rafId = requestAnimationFrame(frame);
        } else if (!go && rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
        }
    });

    function togglePlay() {
        if (!playing && clockMin >= DAY_MINUTES) clockMin = 0;
        playing = !playing;
    }

    function scrub(value: number) {
        playing = false;
        clockMin = Math.max(0, Math.min(value, DAY_MINUTES));
        renderFrame();
    }

    onMount(() => {
        const observer = new IntersectionObserver(
            (entries) => (visible = entries[0].isIntersecting),
            { threshold: 0.1 }
        );
        if (container) observer.observe(container);

        void (async () => {
            const [maplibre, deckMapbox, deckLayers] = await Promise.all([
                loadMaplibre(),
                import('@deck.gl/mapbox'),
                import('@deck.gl/layers'),
            ]);
            if (destroyed || !container) return;

            ScatterplotLayerCtor = deckLayers.ScatterplotLayer as unknown as new (
                props: unknown
            ) => unknown;
            LineLayerCtor = deckLayers.LineLayer as unknown as new (props: unknown) => unknown;

            const theme = themeStore.theme;
            appliedTheme = theme;
            if (destroyed || !container) return;

            map = new maplibre.Map({
                container,
                style: STYLE_URL[theme],
                // `preserveDrawingBuffer` is what the share button needs:
                // without it WebGL throws the basemap's pixels away the moment
                // the browser has composited them, and every export of this map
                // comes back as bare dots over nothing. deck.gl's own canvas
                // already preserves its buffer by default, so this is the only
                // layer that has to be asked; the cost is a copy per frame on a
                // map that is static most of the time.
                //
                // The rest restates MapLibre's own defaults, which this object
                // replaces rather than extends.
                canvasContextAttributes: {
                    antialias: false,
                    powerPreference: 'high-performance',
                    failIfMajorPerformanceCaveat: false,
                    desynchronized: false,
                    preserveDrawingBuffer: true,
                },
            });
            // Interactive pan/zoom (the initial fit is only a starting point), but
            // keep it a flat top-down city map — no rotation or tilt.
            map.dragRotate.disable();
            map.touchZoomRotate.disableRotation();
            const nav = new maplibre.NavigationControl({ showCompass: false });
            map.addControl(nav, 'top-right');
            // The zoom buttons are chrome, not the map. The attribution beside
            // them is not: OpenFreeMap's tiles are OpenStreetMap data, and an
            // exported picture of them carries the same credit the page does.
            markAsChrome(nav);
            overlay = new deckMapbox.MapboxOverlay({
                interleaved: false,
                layers: makeLayers() as never,
            });
            map.addControl(overlay as unknown as IControl);
            map.on('load', () => {
                if (map && dataset.bounds) {
                    map.fitBounds(dataset.bounds, { padding: 24, animate: false });
                }
                renderFrame();
            });
            ready = true;
        })();

        return () => observer.disconnect();
    });

    onDestroy(() => {
        destroyed = true;
        if (rafId) cancelAnimationFrame(rafId);
        map?.remove();
        map = null;
        overlay = null;
    });

    /* ---------------------------------------------------------------- export */

    /**
     * A day, compressed into something shareable.
     *
     * Seeking is a two-step here, unlike every other chart: `renderFrame` only
     * hands deck.gl new layer props, and deck draws them on its own animation
     * loop. So the seek waits for a repaint before it claims to be at `t` —
     * without it the recorder photographs the frame before the one it asked for,
     * all the way through the clip.
     *
     * A whole day fits in twelve seconds at 1×, divided by whichever speed the
     * reader picked — the file crosses the timeline as fast as the screen does.
     */
    const EXPORT_BASE_MS = 12_000;
    const EXPORT_MS = $derived(clipDurationMs(EXPORT_BASE_MS, speed));

    let clockBeforeExport = 0;
    let playingBeforeExport = false;

    const shareSource = $derived<ShareSource>({
        name: 'day-race-map',
        title: 'Every day at once',
        element: () => container,
        animation: {
            durationMs: EXPORT_MS,
            speed,
            begin: () => {
                playingBeforeExport = playing;
                playing = false;
                clockBeforeExport = clockMin;
            },
            end: () => {
                clockMin = clockBeforeExport;
                renderFrame();
                playing = playingBeforeExport;
            },
            seek: async (t) => {
                clockMin = Math.min(t, 0.9999) * DAY_MINUTES;
                renderFrame();
                await nextRepaint();
                await nextRepaint();
            },
        },
    });

    /**
     * Keeps a MapLibre control out of the exported picture.
     *
     * The control owns its own DOM, so the attribute the compositor looks for
     * has to be put on it from the outside; `_container` is the only handle
     * MapLibre offers and it is not in the public typings.
     */
    function markAsChrome(control: IControl): void {
        const element = (control as { _container?: HTMLElement })._container;
        element?.setAttribute('data-export-hide', '');
    }

    function nextRepaint(): Promise<void> {
        return new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }

    // Follow the app theme: reload the minimal basemap, keeping camera + overlay.
    $effect(() => {
        const theme = themeStore.theme;
        if (!ready || !map || theme === appliedTheme) return;
        appliedTheme = theme;
        map.setStyle(STYLE_URL[theme]);
    });
</script>

<div class="day-race">
    <div class="controls">
        <button
            type="button"
            class="race-btn"
            onclick={() => {
                trackControl('day-race-map', 'playback', playing ? 'pause' : 'play');
                togglePlay();
            }}
            aria-pressed={playing}
        >
            {playing ? 'Pause' : 'Play'}
        </button>
        <div class="speeds">
            {#each SPEEDS as s (s)}
                <button
                    type="button"
                    class="race-btn speed"
                    class:active={speed === s}
                    onclick={() => {
                        trackControl('day-race-map', 'speed', s);
                        speed = s;
                    }}
                >
                    {s}×
                </button>
            {/each}
        </div>
        <span class="clock tabular-nums">{clockLabel}</span>
        <div class="spacer"></div>
        <div class="colors" role="group" aria-label="Dot colour">
            {#if hasBothSources}
                <button
                    type="button"
                    class="race-btn color"
                    class:active={colorMode === 'source'}
                    onclick={() => {
                        trackControl('day-race-map', 'color-mode', 'source');
                        colorMode = 'source';
                    }}
                >
                    Source
                </button>
            {/if}
            <button
                type="button"
                class="race-btn color"
                class:active={colorMode === 'flat'}
                onclick={() => {
                    trackControl('day-race-map', 'color-mode', 'flat');
                    colorMode = 'flat';
                }}
            >
                Flat
            </button>
            <button
                type="button"
                class="race-btn color"
                class:active={colorMode === 'doy'}
                onclick={() => {
                    trackControl('day-race-map', 'color-mode', 'doy');
                    colorMode = 'doy';
                }}
            >
                Day of year
            </button>
            <button
                type="button"
                class="race-btn color"
                class:active={colorMode === 'date'}
                onclick={() => {
                    trackControl('day-race-map', 'color-mode', 'date');
                    colorMode = 'date';
                }}
            >
                Date
            </button>
        </div>
        <span class="caption">
            {dataset.tracks.length.toLocaleString()} days
        </span>
        <ShareMenu source={shareSource} vizId="day-race-map" floating={false} />
    </div>

    {#if scaleLabels}
        <div class="scale">
            <span class="scale-lbl">{scaleLabels.lo}</span>
            <span class="scale-bar" style:background={TURBO_GRADIENT}></span>
            <span class="scale-lbl">{scaleLabels.hi}</span>
        </div>
    {:else if colorMode === 'source' && hasBothSources}
        <div class="scale">
            <span class="swatch" style:background="rgb({GARMIN_RGB.join(' ')})"></span>
            <span class="scale-lbl">Garmin · {sourceCounts.garmin.toLocaleString()}</span>
            <span class="swatch" style:background="rgb({DOT_RGB.join(' ')})"></span>
            <span class="scale-lbl">Phone · {sourceCounts.phone.toLocaleString()}</span>
        </div>
    {/if}

    <input
        type="range"
        class="race-scrubber"
        min="0"
        max={DAY_MINUTES}
        step="1"
        value={clockMin}
        oninput={(e) => {
            trackControl('day-race-map', 'scrub', 'drag');
            scrub(+e.currentTarget.value);
        }}
        aria-label="Time of day"
        style={`--progress:${(clockMin / DAY_MINUTES) * 100}%`}
    />

    <div class="map-shell">
        <div class="map" bind:this={container}></div>
    </div>
</div>

<style>
    .day-race {
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

    .speeds,
    .colors {
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

    .scale {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .swatch {
        width: 0.6rem;
        height: 0.6rem;
        border-radius: 2px;
        flex: none;
    }

    .scale-bar {
        flex: 1;
        height: 8px;
        border-radius: var(--radius-pill);
        border: 1px solid hsl(var(--border));
    }

    .scale-lbl {
        font-size: var(--text-label);
        color: hsl(var(--muted-foreground));
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
    }

    .map-shell {
        height: 660px;
        border-radius: var(--radius-md);
        overflow: hidden;
        border: 1px solid hsl(var(--border));
    }

    .map {
        width: 100%;
        height: 100%;
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
        padding: 0.35rem 0.8rem;
        font-size: var(--text-body);
        cursor: pointer;
    }

    .race-btn.speed,
    .race-btn.color {
        padding: 0.3rem 0.6rem;
        font-size: var(--text-small);
    }

    .race-btn.speed.active,
    .race-btn.color.active {
        border-color: var(--module-accent);
        color: var(--module-accent);
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

    .race-scrubber:focus-visible::-webkit-slider-thumb {
        box-shadow: 0 0 0 3px hsl(var(--ring) / 0.7);
    }
</style>
