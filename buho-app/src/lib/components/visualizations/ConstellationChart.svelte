<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import * as d3 from "d3";
    import type { ConnectablePoint } from "$lib/data/queries/behaviorQueries";
    import { OTHER_COLOR } from "$lib/utils/dimensionColors";
    import {
        openSpotify,
        hasOpenModifier,
        MODIFIER_LABEL,
    } from "$lib/utils/spotify";
    import { vizColors } from "$lib/visualizations/themeColors";
    import { themeStore } from "$lib/stores/themeStore.svelte";

    interface ColorCategory {
        value: string;
        color: string;
    }

    interface Props {
        data: ConnectablePoint[];
        width: number;
        height: number;
        timeDomain?: [number, number] | null;
        viewTimeDomain?: [number, number] | null;
        viewHourDomain?: [number, number] | null;
        // Optionnel : quand l'appelant garde une référence `data` stable et ne
        // fait que muter le flag `matched` en place, il bumpe ce compteur pour
        // déclencher un redraw sans reconstruire scaledData/quadtree (cf.
        // /spotify/explore). Laisser à 0 → comportement historique.
        matchVersion?: number;
        // Coloration par dimension. `colorField` = champ brut porté par les points
        // (ex. "platform") ; `colorCategories` = valeurs ordonnées + couleurs (la
        // dernière étant typiquement "Other"). Quand fournis, les points matched
        // et les barcharts satellites sont colorés/empilés par cette dimension.
        colorField?: string | null;
        colorCategories?: ColorCategory[];
    }

    let {
        data = [],
        width = 800,
        height = 600,
        timeDomain = null,
        viewTimeDomain = $bindable(null),
        viewHourDomain = $bindable(null),
        matchVersion = 0,
        colorField = null,
        colorCategories = [],
    }: Props = $props();

    const colorActive = $derived(!!colorField && colorCategories.length > 0);

    // value → couleur et value → index de segment (pour l'empilement). Une valeur
    // inconnue retombe sur "Other" si présent, sinon sur la dernière catégorie.
    const colorMap = $derived.by(() => {
        const m = new Map<string, string>();
        for (const c of colorCategories) m.set(c.value, c.color);
        return m;
    });
    const valueIndex = $derived.by(() => {
        const m = new Map<string, number>();
        colorCategories.forEach((c, i) => m.set(c.value, i));
        return m;
    });
    const otherIndex = $derived(
        colorCategories.findIndex((c) => c.value === "Other"),
    );

    function pointColorValue(point: ConnectablePoint): string {
        return colorField
            ? ((point as unknown as Record<string, unknown>)[
                  colorField
              ] as string)
            : "";
    }
    function colorFor(point: ConnectablePoint): string {
        return colorMap.get(pointColorValue(point)) ?? OTHER_COLOR;
    }
    function segmentIndex(point: ConnectablePoint): number {
        const i = valueIndex.get(pointColorValue(point));
        if (i !== undefined) return i;
        return otherIndex; // -1 si pas de bucket "Other" → ignoré dans l'empilement
    }

    // --- Animation de coloration (balayage des barcharts) ----------------
    // À l'entrée en mode coloration (ou au changement de dimension), un front
    // balaie les barcharts satellites — les dates de gauche à droite, les heures
    // de haut en bas — et chaque barre se colore à son passage, avec un léger
    // « pop » d'épaisseur. Le scatterplot n'est PAS animé (trop coûteux : 167k
    // points re-triés par frame). `colorAnimProgress` = 1 au repos (tout coloré).
    const COLOR_ANIM_MS = 800; // durée du balayage de bout en bout
    const POP_SPAN = 0.15; // largeur (en progression) de la fenêtre de pop
    // La progression va jusqu'à 1 + POP_SPAN : ce surplus laisse la vague de pop
    // de la dernière barre (seuil t≈1) se terminer au lieu d'être coupée net.
    const COLOR_ANIM_END = 1 + POP_SPAN;
    let colorAnimProgress = COLOR_ANIM_END;
    let colorAnimRaf: number | null = null;
    let colorAnimStart = 0;

    function startColorAnim() {
        // Respecte les préférences système : pas de balayage si réduit.
        if (
            typeof window !== "undefined" &&
            window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ) {
            colorAnimProgress = 1;
            return;
        }
        colorAnimStart = performance.now();
        colorAnimProgress = 0;
        if (colorAnimRaf !== null) cancelAnimationFrame(colorAnimRaf);
        const step = () => {
            const t = Math.min(
                1,
                (performance.now() - colorAnimStart) / COLOR_ANIM_MS,
            );
            colorAnimProgress = d3.easeQuadOut(t) * COLOR_ANIM_END;
            // Seuls les barcharts sont animés (le scatterplot reste figé/coloré).
            drawBottomPanel();
            drawLeftPanel();
            if (t < 1) {
                colorAnimRaf = requestAnimationFrame(step);
            } else {
                colorAnimRaf = null;
                colorAnimProgress = COLOR_ANIM_END;
            }
        };
        colorAnimRaf = requestAnimationFrame(step);
    }

    // Amplitude de pop [0,1] pour une barre dont le seuil de révélation est `t`
    // (0 = première révélée, 1 = dernière). Nul hors de la fenêtre de passage.
    function barPop(t: number): number {
        const phase = (colorAnimProgress - t) / POP_SPAN;
        if (phase < 0 || phase > 1) return 0;
        return Math.sin(Math.PI * phase);
    }

    const layout = {
        gap: 8,
        sideWidth: 92,
        bottomHeight: 102,
    };
    const axisGutter = {
        left: 42,
        right: 12,
        top: 12,
        bottom: 24,
    };
    const GUIDE_SPOTIFY_COLOR = "#1DB954";
    const OUT_OF_BRUSH_BAR_COLOR = "#6b645c";
    const UNMATCHED_POINT_COLOR = "#6b645c";
    const UNMATCHED_POINT_ALPHA = 0.22;
    // Chrome des panneaux canvas — suit le thème (toggle light/dark). Le canvas
    // manipule des chaînes de couleur, on relit donc les tokens à chaque draw.
    const panelColors = $derived.by(() => {
        void themeStore.theme;
        const c = vizColors();
        return {
            bg: c.background,
            grid: c.border,
            axisText: c.mutedForeground,
            baseline: c.border,
        };
    });

    let mainCanvas: HTMLCanvasElement | null = null;
    let xCanvas: HTMLCanvasElement | null = null;
    let yCanvas: HTMLCanvasElement | null = null;
    let xBrushLayer: SVGSVGElement | null = null;
    let yBrushLayer: SVGSVGElement | null = null;

    let mainCtx: CanvasRenderingContext2D | null = null;
    let xCtx: CanvasRenderingContext2D | null = null;
    let yCtx: CanvasRenderingContext2D | null = null;

    let zoomBehavior: d3.ZoomBehavior<HTMLCanvasElement, unknown> | null = null;
    let xBrush: d3.BrushBehavior<unknown> | null = null;
    let yBrush: d3.BrushBehavior<unknown> | null = null;

    let rafId: number | null = null;
    let suppressBrushEvent = false;

    let tooltip = $state({
        visible: false,
        x: 0,
        y: 0,
        track: "",
        artist: "",
        date: "",
        uri: null as string | null,
    });

    const panel = $derived.by(() => {
        const mainWidth = Math.max(280, width - layout.sideWidth - layout.gap);
        const mainHeight = Math.max(
            220,
            height - layout.bottomHeight - layout.gap,
        );
        return {
            mainWidth,
            mainHeight,
            sideWidth: layout.sideWidth,
            bottomHeight: layout.bottomHeight,
        };
    });

    const xRange = $derived.by(
        () =>
            [axisGutter.left, panel.mainWidth - axisGutter.right] as [
                number,
                number,
            ],
    );
    const yRange = $derived.by(
        () =>
            [axisGutter.top, panel.mainHeight - axisGutter.bottom] as [
                number,
                number,
            ],
    );

    const bottomPanelBounds = $derived.by(() => ({
        left: xRange[0],
        right: xRange[1],
        top: 6,
        bottom: panel.bottomHeight - 20,
    }));

    const sidePanelBounds = $derived.by(() => ({
        left: 10,
        right: panel.sideWidth - 10,
        top: yRange[0],
        bottom: yRange[1],
    }));

    const effectiveTimeDomain = $derived.by((): [number, number] => {
        if (
            timeDomain &&
            Number.isFinite(timeDomain[0]) &&
            Number.isFinite(timeDomain[1]) &&
            timeDomain[0] < timeDomain[1]
        ) {
            return timeDomain as [number, number];
        }

        if (!data.length) {
            const now = Date.now();
            return [now - 86400000, now];
        }

        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (const point of data) {
            if (point.x < min) min = point.x;
            if (point.x > max) max = point.x;
        }
        if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
            const now = Date.now();
            return [now - 86400000, now];
        }
        return [min, max];
    });

    let viewXDomain = $state<[number, number]>([0, 1]);
    let viewYDomain = $state<[number, number]>([0, 24]);
    let committedXDomain = $state<[number, number]>([0, 1]);
    let committedYDomain = $state<[number, number]>([0, 24]);
    let domainsInitialized = false;
    let lastEffectiveDomainKey = "";

    const baseXScale = $derived.by(() =>
        d3
            .scaleTime<number, number>()
            .domain(
                effectiveTimeDomain.map((value) => new Date(value)) as [
                    Date,
                    Date,
                ],
            )
            .range(xRange),
    );

    const sideYScale = $derived.by(() =>
        d3
            .scaleLinear()
            .domain([0, 24])
            .range([sidePanelBounds.top, sidePanelBounds.bottom]),
    );

    const xScale = $derived.by(() =>
        d3
            .scaleTime<number, number>()
            .domain(viewXDomain.map((value) => new Date(value)) as [Date, Date])
            .range(xRange),
    );

    const yScale = $derived.by(() =>
        d3.scaleLinear().domain(viewYDomain).range(yRange),
    );

    interface ScaledPoint {
        x: number;
        y: number;
        original: ConnectablePoint;
    }

    const scaledData = $derived.by((): ScaledPoint[] =>
        data.map((point) => ({
            x: xScale(point.x),
            y: yScale(point.y),
            original: point,
        })),
    );

    const quadtree = $derived.by(() => {
        if (!scaledData.length) return null;
        return d3
            .quadtree<ScaledPoint>()
            .x((point) => point.x)
            .y((point) => point.y)
            .addAll(scaledData);
    });

    const segCount = $derived(colorActive ? colorCategories.length : 0);

    const monthlyBars = $derived.by(() => {
        void matchVersion; // recompute when `matched` is mutated in place
        const counts = new Map<number, number>();
        // En mode coloration : décompte par catégorie (segments[idx]) par mois.
        const segs = colorActive ? new Map<number, number[]>() : null;
        for (const point of data) {
            if (!point.matched) continue;
            if (point.y < committedYDomain[0] || point.y > committedYDomain[1])
                continue;
            const month = new Date(point.x);
            month.setDate(1);
            month.setHours(0, 0, 0, 0);
            const key = month.getTime();
            counts.set(key, (counts.get(key) || 0) + 1);
            if (segs) {
                const si = segmentIndex(point);
                if (si >= 0) {
                    let arr = segs.get(key);
                    if (!arr) {
                        arr = new Array(segCount).fill(0);
                        segs.set(key, arr);
                    }
                    arr[si] += 1;
                }
            }
        }

        // Build a continuous monthly timeline so the bottom bars stay aligned
        // with the main time axis even when some months have zero plays.
        const [domainStart, domainEnd] = effectiveTimeDomain;
        const cursor = new Date(domainStart);
        cursor.setDate(1);
        cursor.setHours(0, 0, 0, 0);

        const end = new Date(domainEnd);
        end.setDate(1);
        end.setHours(0, 0, 0, 0);

        const series: Array<{
            monthStartMs: number;
            count: number;
            segments: number[] | null;
        }> = [];
        while (cursor <= end) {
            const key = cursor.getTime();
            series.push({
                monthStartMs: key,
                count: counts.get(key) || 0,
                segments: segs ? (segs.get(key) ?? null) : null,
            });
            cursor.setMonth(cursor.getMonth() + 1);
        }

        return series;
    });

    const hourBars = $derived.by(() => {
        void matchVersion; // recompute when `matched` is mutated in place
        const step = 15;
        const binCount = Math.ceil((24 * 60) / step);
        const bins = Array.from({ length: binCount }, (_, index) => ({
            startHour: (index * step) / 60,
            endHour: Math.min(24, ((index + 1) * step) / 60),
            count: 0,
            segments: colorActive
                ? (new Array(segCount).fill(0) as number[])
                : null,
        }));

        for (const point of data) {
            if (!point.matched) continue;
            if (point.x < committedXDomain[0] || point.x > committedXDomain[1])
                continue;
            const minuteOfDay = Math.max(
                0,
                Math.min(1439, Math.floor(point.y * 60)),
            );
            const binIndex = Math.min(
                binCount - 1,
                Math.floor(minuteOfDay / step),
            );
            const bin = bins[binIndex];
            bin.count += 1;
            if (bin.segments) {
                const si = segmentIndex(point);
                if (si >= 0) bin.segments[si] += 1;
            }
        }

        return bins;
    });

    function clampXDomain(domain: [number, number]): [number, number] {
        const [minX, maxX] = effectiveTimeDomain;
        let [start, end] = domain;
        if (start > end) [start, end] = [end, start];
        start = Math.min(Math.max(start, minX), maxX);
        end = Math.min(Math.max(end, minX), maxX);
        if (start >= end) {
            const safeStart = Math.max(minX, Math.min(start, maxX - 86400000));
            const safeEnd = Math.min(maxX, safeStart + 86400000);
            return [safeStart, safeEnd > safeStart ? safeEnd : maxX];
        }
        return [start, end];
    }

    function clampYDomain(domain: [number, number]): [number, number] {
        let [start, end] = domain;
        if (start > end) [start, end] = [end, start];
        start = Math.max(0, start);
        end = Math.min(24, end);
        if (start >= end) {
            const safeEnd = Math.min(24, start + 1);
            return [start, safeEnd > start ? safeEnd : 24];
        }
        return [start, end];
    }

    function scheduleRender() {
        if (!mainCtx || !xCtx || !yCtx) return;
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
            drawMain();
            drawBottomPanel();
            drawLeftPanel();
        });
    }

    function drawMain() {
        if (!mainCtx) return;
        const ctx = mainCtx;
        const [x0, x1] = xRange;
        const [y0, y1] = yRange;

        ctx.clearRect(0, 0, panel.mainWidth, panel.mainHeight);
        ctx.fillStyle = panelColors.bg;
        ctx.fillRect(0, 0, panel.mainWidth, panel.mainHeight);

        ctx.strokeStyle = panelColors.grid;
        ctx.fillStyle = panelColors.axisText;
        ctx.lineWidth = 1;
        ctx.font = "10px Inter, sans-serif";

        const yTicks = d3.range(0, 25, 2);
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        for (const tick of yTicks) {
            const y = yScale(tick);
            if (y < y0 - 1 || y > y1 + 1) continue;
            ctx.globalAlpha = 0.28;
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.lineTo(x1, y);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.fillText(`${tick}h`, x0 - 6, y);
        }

        const xTicks = xScale.ticks(8);
        const formatTick = d3.timeFormat("%b %Y");
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        for (const tick of xTicks) {
            const x = xScale(tick);
            ctx.globalAlpha = 0.28;
            ctx.beginPath();
            ctx.moveTo(x, y0);
            ctx.lineTo(x, y1);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.fillText(formatTick(tick), x, y1 + 6);
        }

        // Two passes: dimmed non-matching points first, matching points on
        // top so the active selection stays readable at high density.
        const pointSize = 2;
        ctx.fillStyle = UNMATCHED_POINT_COLOR;
        ctx.globalAlpha = UNMATCHED_POINT_ALPHA;
        for (const point of scaledData) {
            if (point.original.matched) continue;
            if (point.x < x0 || point.x > x1 || point.y < y0 || point.y > y1)
                continue;
            ctx.fillRect(
                point.x - pointSize / 2,
                point.y - pointSize / 2,
                pointSize,
                pointSize,
            );
        }

        ctx.globalAlpha = 0.7;
        if (colorActive) {
            // Regroupe les points matched par couleur en un seul passage pour
            // minimiser les changements de fillStyle (un draw par catégorie).
            // Le scatterplot n'est pas balayé : tout est coloré directement.
            const buckets = new Map<string, ScaledPoint[]>();
            for (const point of scaledData) {
                if (!point.original.matched) continue;
                if (
                    point.x < x0 ||
                    point.x > x1 ||
                    point.y < y0 ||
                    point.y > y1
                )
                    continue;
                const c = colorFor(point.original);
                let arr = buckets.get(c);
                if (!arr) {
                    arr = [];
                    buckets.set(c, arr);
                }
                arr.push(point);
            }
            for (const [color, pts] of buckets) {
                ctx.fillStyle = color;
                for (const point of pts) {
                    ctx.fillRect(
                        point.x - pointSize / 2,
                        point.y - pointSize / 2,
                        pointSize,
                        pointSize,
                    );
                }
            }
        } else {
            ctx.fillStyle = GUIDE_SPOTIFY_COLOR;
            ctx.globalAlpha = 0.62;
            for (const point of scaledData) {
                if (!point.original.matched) continue;
                if (
                    point.x < x0 ||
                    point.x > x1 ||
                    point.y < y0 ||
                    point.y > y1
                )
                    continue;
                ctx.fillRect(
                    point.x - pointSize / 2,
                    point.y - pointSize / 2,
                    pointSize,
                    pointSize,
                );
            }
        }

        ctx.globalAlpha = 1;
    }

    function drawBottomPanel() {
        if (!xCtx) return;
        const ctx = xCtx;
        const heightPx = panel.bottomHeight;
        const { left: x0, right: x1, top, bottom } = bottomPanelBounds;

        ctx.clearRect(0, 0, panel.mainWidth, heightPx);
        ctx.fillStyle = panelColors.bg;
        ctx.fillRect(0, 0, panel.mainWidth, heightPx);

        const maxCount = Math.max(1, ...monthlyBars.map((bar) => bar.count));
        const barScale = d3
            .scaleLinear()
            .domain([0, maxCount])
            .range([bottom, top]);

        const monthKeys = monthlyBars.map((bar) => bar.monthStartMs);
        const monthBand = d3
            .scaleBand<number>()
            .domain(monthKeys)
            .range([x0, x1])
            .paddingInner(0.22)
            .paddingOuter(0);

        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, top, x1 - x0, bottom - top);
        ctx.clip();

        for (const bar of monthlyBars) {
            const bx = monthBand(bar.monthStartMs);
            if (bx === undefined) continue;
            const bw = Math.max(1, monthBand.bandwidth());
            const nextMonthStart = new Date(bar.monthStartMs);
            nextMonthStart.setMonth(nextMonthStart.getMonth() + 1);

            const monthCenterMs =
                bar.monthStartMs +
                Math.max(1, nextMonthStart.getTime() - bar.monthStartMs) / 2;
            const isInWindow =
                monthCenterMs >= viewXDomain[0] &&
                monthCenterMs <= viewXDomain[1];

            // Balayage gauche → droite : 0 = bord gauche (révélé en premier).
            const cx = bx + bw / 2;
            const t = (cx - x0) / (x1 - x0);
            const revealed = colorAnimProgress >= t;

            if (colorActive && isInWindow && bar.segments && revealed) {
                // Empilement de bas en haut — seulement dans la fenêtre de brush.
                // Pop au passage du front : un peu plus haut et plus large.
                const pop = barPop(t);
                const sV = 1 + pop * 0.18;
                const sH = 1 + pop * 0.3;
                const drawW = bw * sH;
                const drawX = cx - drawW / 2;
                ctx.globalAlpha = 0.9;
                let acc = 0;
                for (let i = 0; i < bar.segments.length; i++) {
                    const seg = bar.segments[i];
                    if (seg <= 0) continue;
                    const yTop = bottom - (bottom - barScale(acc + seg)) * sV;
                    const yBot = bottom - (bottom - barScale(acc)) * sV;
                    ctx.fillStyle = colorCategories[i].color;
                    ctx.fillRect(drawX, yTop, drawW, yBot - yTop);
                    acc += seg;
                }
            } else {
                ctx.globalAlpha = 0.85;
                const y = barScale(bar.count);
                ctx.fillStyle = isInWindow
                    ? GUIDE_SPOTIFY_COLOR
                    : OUT_OF_BRUSH_BAR_COLOR;
                ctx.fillRect(bx, y, bw, bottom - y);
            }
        }
        ctx.restore();

        ctx.globalAlpha = 1;
        ctx.strokeStyle = panelColors.baseline;
        ctx.beginPath();
        ctx.moveTo(x0, bottom + 0.5);
        ctx.lineTo(x1, bottom + 0.5);
        ctx.stroke();
    }

    function drawLeftPanel() {
        if (!yCtx) return;
        const ctx = yCtx;
        const widthPx = panel.sideWidth;
        const { top: y0, bottom: y1, left, right } = sidePanelBounds;

        ctx.clearRect(0, 0, widthPx, panel.mainHeight);
        ctx.fillStyle = panelColors.bg;
        ctx.fillRect(0, 0, widthPx, panel.mainHeight);

        const maxCount = Math.max(1, ...hourBars.map((bar) => bar.count));
        const countScale = d3
            .scaleLinear()
            .domain([0, maxCount])
            .range([left, right]);

        // Les barres horaires partent du bord droit vers la gauche.
        const xForCount = (c: number) => right - (countScale(c) - left);
        for (const bar of hourBars) {
            const yStart = sideYScale(bar.startHour);
            const yEnd = sideYScale(bar.endHour);
            const y = Math.max(y0, yStart);
            const h = Math.max(1, Math.min(y1, yEnd) - y);
            const hourCenter = (bar.startHour + bar.endHour) / 2;
            const isInWindow =
                hourCenter >= viewYDomain[0] && hourCenter <= viewYDomain[1];

            // Balayage bas → haut : 0 = en bas (révélé en premier).
            const yc = sideYScale(hourCenter);
            const t = (y1 - yc) / (y1 - y0);
            const revealed = colorAnimProgress >= t;

            if (colorActive && isInWindow && bar.segments && revealed) {
                // Empilement coloré au passage du front, avec un pop : un peu plus
                // épais (hauteur) et un peu plus long.
                const pop = barPop(t);
                const sV = 1 + pop * 0.3;
                const sL = 1 + pop * 0.18;
                const barH = h * 0.92;
                const drawH = barH * sV;
                const drawY = y + barH / 2 - drawH / 2;
                ctx.globalAlpha = 0.9;
                let acc = 0;
                for (let i = 0; i < bar.segments.length; i++) {
                    const seg = bar.segments[i];
                    if (seg <= 0) continue;
                    const xRight = right - (right - xForCount(acc)) * sL;
                    const xLeft = right - (right - xForCount(acc + seg)) * sL;
                    ctx.fillStyle = colorCategories[i].color;
                    ctx.fillRect(
                        xLeft,
                        drawY,
                        Math.max(1, xRight - xLeft),
                        drawH,
                    );
                    acc += seg;
                }
            } else {
                ctx.globalAlpha = 0.85;
                const xStart = xForCount(bar.count);
                ctx.fillStyle = isInWindow
                    ? GUIDE_SPOTIFY_COLOR
                    : OUT_OF_BRUSH_BAR_COLOR;
                ctx.fillRect(xStart, y, Math.max(1, right - xStart), h * 0.92);
            }
        }
        ctx.globalAlpha = 1;

        ctx.strokeStyle = panelColors.baseline;
        ctx.beginPath();
        ctx.moveTo(right + 0.5, y0);
        ctx.lineTo(right + 0.5, y1);
        ctx.stroke();
    }

    function hideTooltip() {
        tooltip.visible = false;
    }

    // La colonne `timestamp` est stockée en mur-horloge UTC (cf.
    // insertSpotifyPlays → toISOString), tandis que l'axe Y utilise l'heure
    // LOCALE (parseSpotify → getHours). On reparse donc le timestamp comme UTC
    // pour reconstruire l'instant d'origine ; toLocaleString redonne alors
    // l'heure locale, cohérente avec l'échelle.
    function formatPlayedAt(playedAt: string): string {
        const d = new Date(`${playedAt.replace(" ", "T")}Z`);
        return Number.isNaN(d.getTime()) ? playedAt : d.toLocaleString();
    }

    function onMouseMove(event: MouseEvent) {
        if (!mainCanvas || !quadtree) return;
        const [mx, my] = d3.pointer(event, mainCanvas);
        const hit = quadtree.find(mx, my, 12);
        if (!hit) {
            hideTooltip();
            return;
        }

        // Apply tooltip bounds checking here
        let tx = mx + 12;
        let ty = my + 12;
        const tooltipApproxWidth = 260;
        const tooltipApproxHeight = 70;

        if (tx + tooltipApproxWidth > panel.mainWidth) {
            tx = mx - tooltipApproxWidth - 12;
        }
        if (ty + tooltipApproxHeight > panel.mainHeight) {
            ty = my - tooltipApproxHeight - 12;
        }

        tooltip = {
            visible: true,
            x: Math.max(0, tx),
            y: Math.max(0, ty),
            track: hit.original.metadata.track,
            artist: hit.original.metadata.artist,
            date: formatPlayedAt(hit.original.metadata.playedAt),
            uri: hit.original.metadata.trackUri,
        };
    }

    /** ⌘/Ctrl+clic sur un point : ouvre le titre survolé sur Spotify. */
    function onClick(event: MouseEvent) {
        if (!hasOpenModifier(event) || !mainCanvas || !quadtree) return;
        const [mx, my] = d3.pointer(event, mainCanvas);
        const hit = quadtree.find(mx, my, 12);
        if (!hit) return;
        if (openSpotify(hit.original.metadata.trackUri)) {
            event.preventDefault();
            event.stopPropagation();
        }
    }

    function syncXBrushToDomain() {
        if (!xBrushLayer || !xBrush) return;
        const selection: [number, number] = [
            baseXScale(viewXDomain[0]),
            baseXScale(viewXDomain[1]),
        ];
        suppressBrushEvent = true;
        d3.select(xBrushLayer).call(xBrush.move as any, selection);
        suppressBrushEvent = false;
    }

    function syncYBrushToDomain() {
        if (!yBrushLayer || !yBrush) return;
        const selection: [number, number] = [
            sideYScale(viewYDomain[0]),
            sideYScale(viewYDomain[1]),
        ];
        suppressBrushEvent = true;
        d3.select(yBrushLayer).call(yBrush.move as any, selection);
        suppressBrushEvent = false;
    }

    function resetView() {
        viewXDomain = effectiveTimeDomain;
        viewYDomain = [0, 24];
        committedXDomain = effectiveTimeDomain;
        committedYDomain = [0, 24];
        viewTimeDomain = null; // Clear manual filter
        viewHourDomain = null; // Clear manual filter
        if (mainCanvas && zoomBehavior) {
            d3.select(mainCanvas).call(zoomBehavior.transform, d3.zoomIdentity);
        }
        syncXBrushToDomain();
        syncYBrushToDomain();
        scheduleRender();
    }

    function initXBrush() {
        if (!xBrushLayer) return;
        const brushExtent: [[number, number], [number, number]] = [
            [bottomPanelBounds.left, bottomPanelBounds.top],
            [bottomPanelBounds.right, bottomPanelBounds.bottom],
        ];
        const xFromSelection = (event: any): [number, number] | null => {
            if (suppressBrushEvent || !event.selection) return null;
            const [sx0, sx1] = event.selection as [number, number];
            return clampXDomain([
                baseXScale.invert(sx0).getTime(),
                baseXScale.invert(sx1).getTime(),
            ]);
        };
        xBrush = d3
            .brushX()
            .handleSize(2)
            .extent(brushExtent)
            // "brush" : mise à jour live pendant le drag. On émet aussi le
            // domaine downstream pour que le sunburst s'actualise en direct ; le
            // consommateur throttle la cadence (cf. +page).
            .on("brush", (event) => {
                const nextX = xFromSelection(event);
                if (!nextX) return;
                viewXDomain = nextX;
                committedXDomain = nextX;
                viewTimeDomain = nextX;
                scheduleRender();
            })
            // "end" : valeur finale au relâchement (garantit le dernier état).
            .on("end", (event) => {
                const nextX = xFromSelection(event);
                if (!nextX) return;
                viewXDomain = nextX;
                committedXDomain = nextX;
                viewTimeDomain = nextX;
                scheduleRender();
            });
        d3.select(xBrushLayer).call(xBrush as any);
        syncXBrushToDomain();
    }

    function initYBrush() {
        if (!yBrushLayer) return;
        const brushExtent: [[number, number], [number, number]] = [
            [sidePanelBounds.left, sidePanelBounds.top],
            [sidePanelBounds.right, sidePanelBounds.bottom],
        ];
        const yFromSelection = (event: any): [number, number] | null => {
            if (suppressBrushEvent || !event.selection) return null;
            const [sy0, sy1] = event.selection as [number, number];
            return clampYDomain([
                sideYScale.invert(sy0),
                sideYScale.invert(sy1),
            ]);
        };
        yBrush = d3
            .brushY()
            .handleSize(2)
            .extent(brushExtent)
            .on("brush", (event) => {
                const nextY = yFromSelection(event);
                if (!nextY) return;
                viewYDomain = nextY;
                committedYDomain = nextY;
                viewHourDomain = nextY;
                scheduleRender();
            })
            .on("end", (event) => {
                const nextY = yFromSelection(event);
                if (!nextY) return;
                viewYDomain = nextY;
                committedYDomain = nextY;
                viewHourDomain = nextY;
                scheduleRender();
            });
        d3.select(yBrushLayer).call(yBrush as any);
        syncYBrushToDomain();
    }

    function initZoom() {
        if (!mainCanvas) return;
        zoomBehavior = d3
            .zoom<HTMLCanvasElement, unknown>()
            .scaleExtent([1, 30])
            .extent([
                [0, 0],
                [panel.mainWidth, panel.mainHeight],
            ])
            .translateExtent([
                [0, 0],
                [panel.mainWidth, panel.mainHeight],
            ])
            .on("zoom", (event) => {
                const zx = event.transform.rescaleX(baseXScale);
                const domain = zx.domain().map((d: Date) => d.getTime()) as [
                    number,
                    number,
                ];
                viewXDomain = clampXDomain(domain);
                committedXDomain = viewXDomain;
                scheduleRender();
            })
            .on("end", () => {
                committedXDomain = viewXDomain;
                // Emit time domain change
                viewTimeDomain = viewXDomain;
                syncXBrushToDomain();
            });

        d3.select(mainCanvas)
            .style("touch-action", "none")
            .call(zoomBehavior)
            .on("mousemove.constellation", onMouseMove)
            .on("mouseleave.constellation", hideTooltip)
            .on("click.constellation", onClick);
    }

    $effect(() => {
        const _width = width;
        const _height = height;
        const _dataCount = data.length;
        const _timeDomain0 = effectiveTimeDomain[0];
        const _timeDomain1 = effectiveTimeDomain[1];
        const effectiveDomainKey = `${effectiveTimeDomain[0]}-${effectiveTimeDomain[1]}`;

        if (!domainsInitialized) {
            viewXDomain = effectiveTimeDomain;
            viewYDomain = [0, 24];
            committedXDomain = effectiveTimeDomain;
            committedYDomain = [0, 24];
            domainsInitialized = true;
            lastEffectiveDomainKey = effectiveDomainKey;
        } else if (effectiveDomainKey !== lastEffectiveDomainKey) {
            viewXDomain = effectiveTimeDomain;
            viewYDomain = [0, 24];
            committedXDomain = effectiveTimeDomain;
            committedYDomain = [0, 24];
            lastEffectiveDomainKey = effectiveDomainKey;
        } else {
            const clampedX = clampXDomain(viewXDomain);
            if (
                clampedX[0] !== viewXDomain[0] ||
                clampedX[1] !== viewXDomain[1]
            ) {
                viewXDomain = clampedX;
            }

            const clampedY = clampYDomain(viewYDomain);
            if (
                clampedY[0] !== viewYDomain[0] ||
                clampedY[1] !== viewYDomain[1]
            ) {
                viewYDomain = clampedY;
            }
        }

        initXBrush();
        initYBrush();
        scheduleRender();
    });

    // Redraw seul quand `matched` a été muté en place (référence `data` stable).
    // scaledData/quadtree ne lisent pas matchVersion → pas de reconstruction.
    $effect(() => {
        void matchVersion;
        void colorActive;
        void colorCategories;
        void colorField;
        if (domainsInitialized) scheduleRender();
    });

    // Redraw du chrome canvas au changement de thème (light/dark).
    $effect(() => {
        void themeStore.theme;
        if (domainsInitialized) scheduleRender();
    });

    // Déclenche le balayage à l'entrée en mode coloration ou au changement de
    // dimension colorée (pas au brush ni au réordonnancement des catégories).
    let prevColorField: string | null = null;
    $effect(() => {
        const f = colorField;
        const active = colorActive;
        if (active && f !== prevColorField) {
            startColorAnim();
        }
        prevColorField = active ? f : null;
    });

    onMount(() => {
        if (!mainCanvas || !xCanvas || !yCanvas) return;
        mainCtx = mainCanvas.getContext("2d");
        xCtx = xCanvas.getContext("2d");
        yCtx = yCanvas.getContext("2d");
        if (!mainCtx || !xCtx || !yCtx) return;

        initZoom();
        initXBrush();
        initYBrush();
        scheduleRender();
    });

    onDestroy(() => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        if (colorAnimRaf !== null) cancelAnimationFrame(colorAnimRaf);
    });
</script>

<div
    class="constellation-layout"
    style={`--side-width:${panel.sideWidth}px; --bottom-height:${panel.bottomHeight}px; --layout-height:${height}px;`}
>
    <div class="y-area">
        <canvas
            bind:this={yCanvas}
            width={panel.sideWidth}
            height={panel.mainHeight}
        ></canvas>
        <svg
            bind:this={yBrushLayer}
            width={panel.sideWidth}
            height={panel.mainHeight}
        ></svg>
    </div>

    <div class="main-area">
        <canvas
            bind:this={mainCanvas}
            width={panel.mainWidth}
            height={panel.mainHeight}
        ></canvas>
        <button class="reset-btn" type="button" onclick={resetView}
            >Reset view</button
        >
        {#if tooltip.visible}
            <div
                class="tooltip"
                style={`left:${tooltip.x}px; top:${tooltip.y}px;`}
            >
                <strong>{tooltip.track}</strong>
                <span>{tooltip.artist}</span>
                <span>{tooltip.date}</span>
                {#if tooltip.uri}
                    <span class="hint"
                        >{MODIFIER_LABEL}+click to play on Spotify</span
                    >
                {/if}
            </div>
        {/if}
    </div>

    <div class="x-area">
        <canvas
            bind:this={xCanvas}
            width={panel.mainWidth}
            height={panel.bottomHeight}
        ></canvas>
        <svg
            bind:this={xBrushLayer}
            width={panel.mainWidth}
            height={panel.bottomHeight}
        ></svg>
    </div>
</div>

<style>
    .constellation-layout {
        width: 100%;
        height: var(--layout-height);
        display: grid;
        grid-template-columns: var(--side-width) minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr) var(--bottom-height);
        gap: 8px;
        background: hsl(var(--background));
    }

    .main-area {
        grid-column: 2;
        grid-row: 1;
        position: relative;
        overflow: hidden;
        border: 1px solid hsl(var(--border));
        border-radius: 8px;
    }

    .x-area {
        grid-column: 2;
        grid-row: 2;
        position: relative;
        border: 1px solid hsl(var(--border));
        border-radius: 8px;
        overflow: hidden;
    }

    .y-area {
        grid-column: 1;
        grid-row: 1;
        position: relative;
        border: 1px solid hsl(var(--border));
        border-radius: 8px;
        overflow: hidden;
    }

    .main-area canvas,
    .x-area canvas,
    .y-area canvas {
        display: block;
        width: 100%;
        height: 100%;
    }

    .x-area svg,
    .y-area svg {
        position: absolute;
        inset: 0;
        overflow: hidden;
        display: block;
        width: 100%;
        height: 100%;
    }

    .x-area :global(.selection),
    .y-area :global(.selection) {
        fill: rgb(148 163 184 / 0.26);
        stroke: none;
    }

    .x-area :global(.handle),
    .y-area :global(.handle) {
        fill: rgb(148 163 184 / 0.9);
        stroke: none;
    }

    .reset-btn {
        position: absolute;
        top: 10px;
        right: 10px;
        z-index: 2;
        border: 1px solid var(--border, hsl(var(--border)));
        border-radius: 999px;
        padding: 0.3rem 0.65rem;
        font-size: 0.72rem;
        color: hsl(var(--foreground));
        background: color-mix(in srgb, hsl(var(--card)) 88%, white 12%);
        cursor: pointer;
    }

    .reset-btn:hover {
        border-color: var(--accent-spotify, #1db954);
        color: var(--accent-spotify, #1db954);
    }

    .tooltip {
        position: absolute;
        pointer-events: none;
        z-index: 3;
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-width: 16rem;
        border-radius: 7px;
        border: 1px solid hsl(var(--border));
        padding: 0.42rem 0.52rem;
        font-size: 0.72rem;
        color: hsl(var(--foreground));
        background: color-mix(in srgb, hsl(var(--card)) 92%, black 8%);
    }

    .tooltip .hint {
        margin-top: 2px;
        font-size: 0.66rem;
        color: var(--accent-spotify, #1db954);
    }
</style>
