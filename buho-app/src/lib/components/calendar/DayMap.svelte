<script lang="ts" module>
    import { asset } from '$app/paths';
    import { feature } from 'topojson-client';
    import type { GeometryCollection, Topology } from 'topojson-specification';
    import type { FeatureCollection, Position } from 'geojson';

    /** One sea polygon — its outer ring and holes — with the box around it, for culling. */
    interface Shape {
        rings: Position[][];
        minLon: number;
        maxLon: number;
        minLat: number;
        maxLat: number;
    }

    /**
     * The coastline, read once per session from the same file zone attribution
     * reads: a static asset of the app, so drawing it asks no one for anything.
     */
    let sea: Promise<Shape[]> | null = null;

    function loadSea(): Promise<Shape[]> {
        sea ??= fetch(asset('geo/ocean.topojson'))
            .then((response) => (response.ok ? response.json() : null))
            .then((topology: Topology | null) => (topology ? shapesOf(topology) : []))
            .catch(() => []);
        return sea;
    }

    function shapesOf(topology: Topology): Shape[] {
        const name = Object.keys(topology.objects)[0];
        const collection = feature(
            topology,
            topology.objects[name] as GeometryCollection
        ) as FeatureCollection;
        const shapes: Shape[] = [];
        for (const { geometry } of collection.features) {
            const polygons =
                geometry.type === 'Polygon'
                    ? [geometry.coordinates]
                    : geometry.type === 'MultiPolygon'
                      ? geometry.coordinates
                      : [];
            for (const rings of polygons) {
                let minLon = Infinity;
                let maxLon = -Infinity;
                let minLat = Infinity;
                let maxLat = -Infinity;
                for (const [lon, lat] of rings[0] ?? []) {
                    minLon = Math.min(minLon, lon);
                    maxLon = Math.max(maxLon, lon);
                    minLat = Math.min(minLat, lat);
                    maxLat = Math.max(maxLat, lat);
                }
                shapes.push({ rings, minLon, maxLon, minLat, maxLat });
            }
        }
        return shapes;
    }
</script>

<script lang="ts">
    import {
        DAY_MINUTES,
        JOIN_GAP_MINUTES,
        positionAt,
        type PositionRow,
    } from '#lib/calendar/timeline.ts';
    import { peakColor, themeHsl } from '#lib/visualizations/themeColors.ts';
    import { themeStore } from '#lib/stores/themeStore.svelte.ts';

    /**
     * Where the open day went, on a small map drawn in the tab: the path, the
     * stays as dots sized by how long they lasted, the coastline and the towns
     * the day's own positions were located in. No tile is fetched — a map that
     * loaded tiles for every day looked at would tell a tile server where each
     * day was spent — and the drawing takes well under a millisecond, so the map
     * keeps up with the hover preview. It is framed on the day shown.
     */
    interface Props {
        points: PositionRow[];
        /** The minute pointed at on the day's tracks; the map marks where you were then. */
        minute?: number | null;
    }

    let { points, minute = null }: Props = $props();

    const WIDTH = 240;
    const HEIGHT = 170;
    const PAD = 18;
    /** The closest the map frames, in km: a day spent at home still reads at street scale. */
    const MIN_SPAN_KM = 2;
    const KM_PER_DEGREE = 111.32;
    const SCALE_STEPS = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

    let canvas = $state<HTMLCanvasElement | null>(null);
    let shapes = $state.raw<Shape[]>([]);

    $effect(() => {
        void loadSea().then((loaded) => (shapes = loaded));
    });

    /** The positions that touch the day, the night's stay included. */
    const day = $derived(points.filter((p) => p.end > 0 && p.start < DAY_MINUTES));

    const frame = $derived.by(() => {
        if (day.length === 0) return null;
        let minLat = Infinity;
        let maxLat = -Infinity;
        let minLon = Infinity;
        let maxLon = -Infinity;
        for (const p of day) {
            minLat = Math.min(minLat, p.lat);
            maxLat = Math.max(maxLat, p.lat);
            minLon = Math.min(minLon, p.lon);
            maxLon = Math.max(maxLon, p.lon);
        }
        const lat = (minLat + maxLat) / 2;
        const lon = (minLon + maxLon) / 2;
        const kx = KM_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
        const spanX = Math.max(MIN_SPAN_KM, (maxLon - minLon) * kx);
        const spanY = Math.max(MIN_SPAN_KM, (maxLat - minLat) * KM_PER_DEGREE);
        /** Pixels per kilometre. */
        const scale = Math.min((WIDTH - 2 * PAD) / spanX, (HEIGHT - 2 * PAD) / spanY);
        return {
            lat,
            lon,
            kx,
            scale,
            halfLon: WIDTH / 2 / (kx * scale),
            halfLat: HEIGHT / 2 / (KM_PER_DEGREE * scale),
        };
    });

    type Frame = NonNullable<typeof frame>;

    function project(f: Frame, lat: number, lon: number): [number, number] {
        return [
            WIDTH / 2 + (lon - f.lon) * f.kx * f.scale,
            HEIGHT / 2 - (lat - f.lat) * KM_PER_DEGREE * f.scale,
        ];
    }

    /** Minutes of a position inside the day. */
    const lasted = (p: PositionRow) => Math.min(p.end, DAY_MINUTES) - Math.max(p.start, 0);

    /** The towns worth naming: the longest stay's, and the farthest point's when it differs. */
    const towns = $derived.by(() => {
        const stays = day.filter((p) => p.stationary);
        const home = stays.reduce<PositionRow | null>(
            (best, p) => (!best || lasted(p) > lasted(best) ? p : best),
            null
        );
        const named: PositionRow[] = [];
        if (home?.city) named.push(home);
        const anchor = home ?? day[0];
        if (anchor) {
            const far = day.reduce((best, p) =>
                Math.hypot(p.lat - anchor.lat, p.lon - anchor.lon) >
                Math.hypot(best.lat - anchor.lat, best.lon - anchor.lon)
                    ? p
                    : best
            );
            if (far.city && far.city !== home?.city) named.push(far);
        }
        return named;
    });

    /** The marker, as a dot laid over the canvas: moving it never repaints the map. */
    const marker = $derived.by(() => {
        const f = frame;
        if (minute === null || !f) return null;
        const at = positionAt(day, minute);
        if (!at) return null;
        const [x, y] = project(f, at.lat, at.lon);
        if (x < 0 || x > WIDTH || y < 0 || y > HEIGHT) return null;
        return { x, y };
    });

    function draw() {
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(WIDTH * dpr);
        canvas.height = Math.round(HEIGHT * dpr);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const land = themeHsl('--card', '#ffffff');
        const water = themeHsl('--muted', '#e5e1da');
        const ink = themeHsl('--foreground', '#242424');
        const accent = peakColor('positions');

        ctx.fillStyle = land;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        const f = frame;
        if (!f) return;

        ctx.fillStyle = water;
        for (const shape of shapes) {
            if (
                shape.maxLon < f.lon - f.halfLon ||
                shape.minLon > f.lon + f.halfLon ||
                shape.maxLat < f.lat - f.halfLat ||
                shape.minLat > f.lat + f.halfLat
            ) {
                continue;
            }
            ctx.beginPath();
            for (const ring of shape.rings) {
                ring.forEach(([lon, lat], k) => {
                    const [x, y] = project(f, lat, lon);
                    if (k === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                });
                ctx.closePath();
            }
            ctx.fill('evenodd');
        }

        // The path, broken wherever the recorder fell silent.
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        let previous: PositionRow | null = null;
        for (const p of day) {
            const [x, y] = project(f, p.lat, p.lon);
            if (previous && p.start - previous.end <= JOIN_GAP_MINUTES) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
            previous = p;
        }
        ctx.stroke();

        // The stays, sized by how long they lasted.
        for (const p of day) {
            if (!p.stationary) continue;
            const [x, y] = project(f, p.lat, p.lon);
            const r = 2.5 + Math.min(5, Math.sqrt(Math.max(0, lasted(p)) / 20));
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = accent;
            ctx.fill();
            ctx.strokeStyle = land;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        ctx.font = '600 10px system-ui, sans-serif';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3;
        ctx.strokeStyle = land;
        ctx.fillStyle = ink;
        for (const town of towns) {
            const [x, y] = project(f, town.lat, town.lon);
            const label = town.city ?? '';
            const width = ctx.measureText(label).width;
            const left = Math.max(4, Math.min(WIDTH - width - 4, x + 6));
            const top = Math.max(14, y - 4);
            ctx.strokeText(label, left, top);
            ctx.fillText(label, left, top);
        }

        // A scale bar: the longest round distance that fits in a third of the width.
        const km =
            SCALE_STEPS.filter((step) => step * f.scale <= WIDTH / 3).pop() ?? SCALE_STEPS[0];
        const length = km * f.scale;
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(8, HEIGHT - 8);
        ctx.lineTo(8 + length, HEIGHT - 8);
        ctx.stroke();
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillStyle = ink;
        ctx.fillText(`${km.toLocaleString()} km`, 8, HEIGHT - 11);
    }

    $effect(() => {
        void themeStore.theme;
        void frame;
        void shapes;
        void towns;
        draw();
    });
</script>

<figure class="day-map" data-module="positions" style:width="{WIDTH}px" style:height="{HEIGHT}px">
    <canvas
        bind:this={canvas}
        style:width="{WIDTH}px"
        style:height="{HEIGHT}px"
        aria-label="Map of the day's positions"
    ></canvas>
    {#if marker}
        <span class="marker" style:left="{marker.x}px" style:top="{marker.y}px"></span>
    {/if}
    {#if day.length === 0}
        <figcaption class="empty">No position this day</figcaption>
    {/if}
</figure>

<style>
    .day-map {
        position: relative;
        margin: 0;
        overflow: hidden;
        border: 1px solid hsl(var(--border));
        border-radius: var(--radius-md);
    }

    canvas {
        display: block;
    }

    .marker {
        position: absolute;
        width: 12px;
        height: 12px;
        box-sizing: border-box;
        border-radius: 999px;
        transform: translate(-50%, -50%);
        border: 2px solid hsl(var(--background));
        background: hsl(var(--foreground));
        box-shadow: 0 0 0 1.5px var(--module-peak);
        pointer-events: none;
    }

    .empty {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: var(--text-label);
        color: hsl(var(--muted-foreground));
    }
</style>
