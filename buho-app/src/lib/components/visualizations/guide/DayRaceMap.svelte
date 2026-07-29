<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { Map as MaplibreMap, IControl } from "maplibre-gl";
    import type { MapboxOverlay } from "@deck.gl/mapbox";
    import type {
        DayRecord,
        DayRaceSegmentRows,
    } from "$lib/data/queries/googleMapsQueries";
    import {
        buildDayRaceDataset,
        sampleDots,
        sampleTrails,
        dayOfYearFraction,
        DAY_MINUTES,
        TRAIL_MAX_SEG,
    } from "$lib/visualizations/dayRaceData";
    import { interpolateTurbo, rgb } from "d3";
    import { themeStore, type Theme } from "$lib/stores/themeStore.svelte";
    import { trackControl } from "$lib/analytics";

    interface Props {
        days: DayRecord[];
        segments: DayRaceSegmentRows;
    }

    let { days, segments }: Props = $props();

    const SEG_COUNT = TRAIL_MAX_SEG;
    // The Google Maps red, matching the constellation / location map.
    const DOT_RGB: [number, number, number] = [234, 67, 53];
    // Dots are translucent so overlapping days accumulate into brighter spots.
    const DOT_ALPHA = 90;
    // Full day (1440 clock-minutes) plays in 45 s at 1×.
    const MIN_PER_MS = DAY_MINUTES / 45000;
    const SPEEDS = [1, 2, 4] as const;
    // red: flat. doy: position in the year (Jan 1 → Dec 31). date: position across
    // the whole timeline (earliest → latest day).
    type ColorMode = "red" | "doy" | "date";
    const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
    const dayMs = (day: string) => {
        const [y, m, d] = day.split("-").map(Number);
        return Date.UTC(y, m - 1, d);
    };
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const fmtMonthYear = (day: string) => {
        const [y, m] = day.split("-");
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
        return `linear-gradient(to right, ${stops.join(", ")})`;
    })();

    // The classic (full) OpenFreeMap basemap per theme — labels, streets and all.
    const STYLE_URL: Record<Theme, string> = {
        dark: "https://tiles.openfreemap.org/styles/dark",
        light: "https://tiles.openfreemap.org/styles/positron",
    };

    const pad = (n: number) => String(n).padStart(2, "0");

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
        if (colorMode === "doy") return { lo: "Jan", hi: "Dec" };
        if (colorMode === "date")
            return dateRange
                ? { lo: fmtMonthYear(dateRange.lo), hi: fmtMonthYear(dateRange.hi) }
                : null;
        return null;
    });

    let clockMin = $state(0);
    let playing = $state(false);
    let speed = $state<(typeof SPEEDS)[number]>(1);
    let colorMode = $state<ColorMode>("red");
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
    // trail colours are rewritten every frame (alpha depends on the clock), while
    // `trackRgb` / `dotColors` change only on a dataset or colour-mode switch.
    let dotPositions = new Float32Array(0);
    let trailSrc = new Float32Array(0);
    let trailDst = new Float32Array(0);
    let trailColors: Uint8Array = new Uint8Array(0);
    let dotColors: Uint8Array = new Uint8Array(0);
    let trackRgb: Uint8Array = new Uint8Array(0);

    // Fraction 0→1 mapped onto the Turbo scale, per colour mode.
    function fractionFor(day: string): number {
        if (colorMode === "doy") return dayOfYearFraction(day);
        const r = dateRange;
        if (!r || r.hiMs === r.loMs) return 0;
        return clamp01((dayMs(day) - r.loMs) / (r.hiMs - r.loMs));
    }

    // One RGB per track: flat red, or a continuous Turbo scale (day-of-year or
    // full-timeline date). Written into `trackRgb` / `dotColors`.
    function buildColors() {
        const tracks = dataset.tracks;
        const n = tracks.length;
        trackRgb = new Uint8Array(n * 3);
        dotColors = new Uint8Array(n * 4);
        const flat = colorMode === "red";
        for (let i = 0; i < n; i++) {
            let r = DOT_RGB[0];
            let g = DOT_RGB[1];
            let b = DOT_RGB[2];
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
                    id: "day-race-trails",
                    data: {
                        length: n * SEG_COUNT,
                        attributes: {
                            getSourcePosition: { value: trailSrc, size: 2 },
                            getTargetPosition: { value: trailDst, size: 2 },
                            getColor: { value: trailColors, size: 4 },
                        },
                    },
                    getWidth: 1.2,
                    widthUnits: "pixels",
                    widthMinPixels: 1,
                    pickable: false,
                }),
            );
        }
        if (ScatterplotLayerCtor) {
            layers.push(
                new ScatterplotLayerCtor({
                    id: "day-race-dots",
                    data: {
                        length: n,
                        attributes: {
                            getPosition: { value: dotPositions, size: 2 },
                            getFillColor: { value: dotColors, size: 4 },
                        },
                    },
                    radiusUnits: "pixels",
                    getRadius: 2.5,
                    radiusMinPixels: 1,
                    pickable: false,
                }),
            );
        }
        return layers;
    }

    function renderFrame() {
        if (!overlay) return;
        if (dataset.tracks.length) {
            sampleDots(dataset.tracks, clockMin, dotPositions);
            sampleTrails(
                dataset.tracks,
                clockMin,
                trailSrc,
                trailDst,
                trailColors,
                trackRgb,
            );
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
            { threshold: 0.1 },
        );
        if (container) observer.observe(container);

        void (async () => {
            const [maplibre, deckMapbox, deckLayers] = await Promise.all([
                import("maplibre-gl"),
                import("@deck.gl/mapbox"),
                import("@deck.gl/layers"),
            ]);
            await import("maplibre-gl/dist/maplibre-gl.css");
            if (destroyed || !container) return;

            ScatterplotLayerCtor = deckLayers.ScatterplotLayer as unknown as new (
                props: unknown,
            ) => unknown;
            LineLayerCtor = deckLayers.LineLayer as unknown as new (
                props: unknown,
            ) => unknown;

            const theme = themeStore.theme;
            appliedTheme = theme;
            if (destroyed || !container) return;

            map = new maplibre.Map({
                container,
                style: STYLE_URL[theme],
            });
            // Interactive pan/zoom (the initial fit is only a starting point), but
            // keep it a flat top-down city map — no rotation or tilt.
            map.dragRotate.disable();
            map.touchZoomRotate.disableRotation();
            map.addControl(
                new maplibre.NavigationControl({ showCompass: false }),
                "top-right",
            );
            overlay = new deckMapbox.MapboxOverlay({
                interleaved: false,
                layers: makeLayers() as never,
            });
            map.addControl(overlay as unknown as IControl);
            map.on("load", () => {
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
                trackControl("day-race-map", "playback", playing ? "pause" : "play");
                togglePlay();
            }}
            aria-pressed={playing}
        >
            {playing ? "Pause" : "Play"}
        </button>
        <div class="speeds">
            {#each SPEEDS as s (s)}
                <button
                    type="button"
                    class="race-btn speed"
                    class:active={speed === s}
                    onclick={() => {
                        trackControl("day-race-map", "speed", s);
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
            <button
                type="button"
                class="race-btn color"
                class:active={colorMode === "red"}
                onclick={() => {
                    trackControl("day-race-map", "color-mode", "red");
                    colorMode = "red";
                }}
            >
                Red
            </button>
            <button
                type="button"
                class="race-btn color"
                class:active={colorMode === "doy"}
                onclick={() => {
                    trackControl("day-race-map", "color-mode", "doy");
                    colorMode = "doy";
                }}
            >
                Day of year
            </button>
            <button
                type="button"
                class="race-btn color"
                class:active={colorMode === "date"}
                onclick={() => {
                    trackControl("day-race-map", "color-mode", "date");
                    colorMode = "date";
                }}
            >
                Date
            </button>
        </div>
        <span class="caption">
            {dataset.tracks.length.toLocaleString()} days
        </span>
    </div>

    {#if scaleLabels}
        <div class="scale">
            <span class="scale-lbl">{scaleLabels.lo}</span>
            <span class="scale-bar" style:background={TURBO_GRADIENT}></span>
            <span class="scale-lbl">{scaleLabels.hi}</span>
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
            trackControl("day-race-map", "scrub", "drag");
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
        font-size: 0.9rem;
        color: hsl(var(--foreground));
        font-variant-numeric: tabular-nums;
    }

    .scale {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .scale-bar {
        flex: 1;
        height: 8px;
        border-radius: 999px;
        border: 1px solid hsl(var(--border));
    }

    .scale-lbl {
        font-size: 0.72rem;
        color: hsl(var(--muted-foreground));
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
    }

    .map-shell {
        height: 660px;
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid hsl(var(--border));
    }

    .map {
        width: 100%;
        height: 100%;
    }

    .caption {
        font-size: 0.8rem;
        color: hsl(var(--muted-foreground));
        margin: 0;
    }

    .race-btn {
        border: 1px solid rgb(71 85 105 / 0.8);
        background: rgb(15 23 42 / 0.7);
        color: rgb(226 232 240 / 1);
        border-radius: 999px;
        padding: 0.35rem 0.8rem;
        font-size: 0.85rem;
        cursor: pointer;
    }

    .race-btn.speed,
    .race-btn.color {
        padding: 0.3rem 0.6rem;
        font-size: 0.8rem;
    }

    .race-btn.speed.active,
    .race-btn.color.active {
        border-color: #ea4335;
        color: #ea4335;
    }

    .race-scrubber {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        height: 4px;
        border-radius: 999px;
        background: linear-gradient(
            to right,
            rgb(234 67 53 / 0.9) var(--progress, 0%),
            rgb(71 85 105 / 0.4) var(--progress, 0%)
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
        background: rgb(226 232 240 / 1);
        box-shadow: 0 0 0 3px rgb(15 23 42 / 0.7);
        transition: transform 0.12s ease;
    }

    .race-scrubber::-moz-range-thumb {
        width: 13px;
        height: 13px;
        border: none;
        border-radius: 50%;
        background: rgb(226 232 240 / 1);
        box-shadow: 0 0 0 3px rgb(15 23 42 / 0.7);
    }

    .race-scrubber:hover::-webkit-slider-thumb,
    .race-scrubber:active::-webkit-slider-thumb {
        transform: scale(1.18);
    }

    .race-scrubber:focus-visible::-webkit-slider-thumb {
        box-shadow: 0 0 0 3px rgb(234 67 53 / 0.6);
    }
</style>
