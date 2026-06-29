<script lang="ts">
    import * as d3 from "d3";
    import type { ExplorerFilterStore, FilterScalar, FilterState } from "$lib/types/filters";
    import {
        bucketByDegree,
        type SunburstNode,
    } from "$lib/visualizations/sunburstHierarchy";
    import {
        createSunburstColorScale,
        SUNBURST_OTHER_COLOR,
    } from "$lib/visualizations/sunburstColors";
    import { vizColors } from "$lib/visualizations/themeColors";
    import { themeStore } from "$lib/stores/themeStore.svelte";

    interface ArcDatum {
        x0: number;
        x1: number;
        y0: number;
        y1: number;
    }

    type RectNode = d3.HierarchyRectangularNode<SunburstNode> & {
        current: ArcDatum;
    };

    interface Props {
        /** Raw hierarchy (pre-bucketing); rebuilt into arcs on change. */
        data: SunburstNode;
        width: number;
        /** Available height: the sunburst stays square, sized on min(width, height). */
        height?: number;
        /** Cross-filtering store (spotify/google-maps share the interface). */
        filters: ExplorerFilterStore;
        /** depth (1-based) → store filter key. Defines the hierarchy's cross-filter keys. */
        keyByDepth: Record<number, string>;
        /** Center label shown at the root (e.g. "All artists" / "All locations"). */
        rootLabel: string;
        /** Format a node value for tooltip + center. Default: rounded + locale. */
        formatValue?: (value: number) => string;
        /** Bucket label per level for the "Other …" rollup. */
        otherLabels?: string[];
        /** Optional: open a leaf externally (e.g. Spotify). Return true if handled (skips filtering). */
        onLeafOpen?: (node: SunburstNode, event: MouseEvent) => boolean;
        /** Optional: whether a node is openable (shows the tooltip hint). */
        canOpen?: (node: SunburstNode) => boolean;
        /** Optional tooltip hint shown on openable leaves. */
        openHint?: string;
        testId?: string;
    }

    let {
        data,
        width,
        height = Infinity,
        filters,
        keyByDepth,
        rootLabel,
        formatValue = (v: number) => Math.round(v).toLocaleString(),
        otherLabels = ["Other"],
        onLeafOpen,
        canOpen,
        openHint,
        testId = "sunburst-explorer",
    }: Props = $props();

    let svgEl = $state<SVGSVGElement>();
    let hostEl = $state<HTMLDivElement>();

    let tooltip = $state({
        visible: false,
        x: 0,
        y: 0,
        path: "",
        value: "",
        openable: false,
    });

    const SELECTABLE_KEYS = $derived(Object.values(keyByDepth));
    const MAX_DEPTH = $derived(
        Math.max(0, ...Object.keys(keyByDepth).map(Number)),
    );

    const hasData = $derived(!!data.children && data.children.length > 0);

    const chartSize = $derived(Math.max(280, Math.min(760, width, height)));

    // D3 selections kept between renders so we can update the highlight (dim)
    // WITHOUT rebuilding the whole SVG: rebuilding ~10k arcs on every click is
    // what was blocking the main thread.
    type ArcSel = d3.Selection<SVGPathElement, RectNode, SVGGElement, unknown>;
    type LabelSel = d3.Selection<SVGTextElement, RectNode, SVGGElement, unknown>;
    let pathSel: ArcSel | null = null;
    let labelSel: LabelSel | null = null;
    let labelGroupSel: d3.Selection<SVGGElement, unknown, null, undefined> | null =
        null;
    let centerNameSel: d3.Selection<SVGTSpanElement, unknown, null, undefined> | null = null;
    let centerValueSel: d3.Selection<SVGTSpanElement, unknown, null, undefined> | null = null;
    let centerCircleSel: d3.Selection<SVGCircleElement, unknown, null, undefined> | null = null;

    // Zoom state. `focusKey` (path of the centered node) survives the rebuilds
    // caused by the time brush; `focusNode` is the ref of the focused node in the
    // current render; `zooming` prevents updateHighlight from short-circuiting the
    // ongoing zoom animation.
    const ZOOM_MS = 750;
    let focusKey = "";
    let focusNode: RectNode | null = null;
    let rootNode: RectNode | null = null;
    let zooming = false;
    let zoomToken = 0;

    // Persistent color scale (green-anchored palette): keyed by the name of the
    // depth-1 node with a domain that grows on demand → a category keeps its color
    // when the time window changes.
    const colorScale = createSunburstColorScale();

    /** Stable key of a node (path) for the data-join. */
    function nodeKey(d: RectNode): string {
        return d
            .ancestors()
            .map((a) => a.data.name)
            .reverse()
            .join("");
    }

    function arcVisible(d: ArcDatum): boolean {
        return d.y1 <= 3 && d.y0 >= 1 && d.x1 > d.x0;
    }

    function labelVisible(d: ArcDatum): boolean {
        return d.y1 <= 3 && d.y0 >= 1 && (d.y1 - d.y0) * (d.x1 - d.x0) > 0.03;
    }

    /** Position of an arc as displayed when `focus` is at the center (zoom). */
    function transformArc(node: RectNode, focus: RectNode): ArcDatum {
        const span = focus.x1 - focus.x0 || 1;
        return {
            x0: Math.max(0, Math.min(1, (node.x0 - focus.x0) / span)) * 2 * Math.PI,
            x1: Math.max(0, Math.min(1, (node.x1 - focus.x0) / span)) * 2 * Math.PI,
            y0: Math.max(0, node.y0 - focus.depth),
            y1: Math.max(0, node.y1 - focus.depth),
        };
    }

    function makeArc(radius: number) {
        return d3
            .arc<ArcDatum>()
            .startAngle((d) => d.x0)
            .endAngle((d) => d.x1)
            .padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.005))
            .padRadius(radius * 1.5)
            .innerRadius((d) => d.y0 * radius)
            .outerRadius((d) => Math.max(d.y0 * radius, d.y1 * radius - 1));
    }

    function labelTransform(d: ArcDatum, radius: number): string {
        const x = (((d.x0 + d.x1) / 2) * 180) / Math.PI;
        const y = ((d.y0 + d.y1) / 2) * radius;
        return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
    }

    function truncate(name: string, max: number): string {
        return name.length > max ? `${name.slice(0, max - 1)}…` : name;
    }

    /** A filter's values normalized to a Set<string>, or null if not applicable. */
    function filterValues(state: FilterState, key: string): Set<string> | null {
        const v = state[key];
        if (v === undefined || v === null) return null;
        if (v instanceof Set) return new Set([...v].map(String));
        if (Array.isArray(v)) return new Set(v.map((x) => String(x)));
        if (typeof v === "object") return null; // ranges, etc. — non applicable
        return new Set([String(v as FilterScalar)]);
    }

    function hasSelection(state: FilterState): boolean {
        return SELECTABLE_KEYS.some((k) => k in state);
    }

    /**
     * A node is "in the selection" if, for every active filter at a level ≤ the
     * node's depth, its ancestor at that level matches. Nodes higher than the
     * filter (ancestors of the selection) stay lit.
     */
    function nodeMatches(node: RectNode, state: FilterState): boolean {
        for (const [depthStr, key] of Object.entries(keyByDepth)) {
            const depth = Number(depthStr);
            const vals = filterValues(state, key);
            if (!vals) continue;
            if (node.depth < depth) continue;
            const anc = node.ancestors().find((a) => a.depth === depth);
            if (!anc || !vals.has(anc.data.name)) return false;
        }
        return true;
    }

    /** Filter = path up to `node`. Root → everything cleared. */
    function setFiltersToPath(node: RectNode) {
        for (const key of SELECTABLE_KEYS) filters.removeFilter(key);
        if (node.depth === 0) return;
        const path = node.ancestors().reverse().slice(1) as RectNode[];
        for (const n of path) {
            const key = keyByDepth[n.depth];
            if (key) filters.setFilter(key, n.data.name);
        }
    }

    // The filter is the source of truth; the zoom follows it (cf. $effect below).
    // So the handlers ONLY set the filter.

    /**
     * Click on an arc: filter on its path (→ the zoom will follow). An optional
     * onLeafOpen (e.g. ⌘+click to open on Spotify) short-circuits the filter.
     */
    function onArcClick(event: MouseEvent, p: RectNode) {
        if (p.data.isOther) return;
        if (onLeafOpen && onLeafOpen(p.data, event)) {
            event.preventDefault();
            return;
        }
        setFiltersToPath(p);
    }

    /** Center click: go up one level, or clear everything at the root. */
    function onCenterClick() {
        const focus = focusNode;
        if (focus && focus.depth > 0) {
            setFiltersToPath((focus.parent as RectNode) ?? focus);
        } else {
            for (const key of SELECTABLE_KEYS) filters.removeFilter(key);
        }
    }

    function scalarName(v: unknown): string | null {
        if (v === undefined || v === null) return null;
        if (v instanceof Set) {
            const a = [...v];
            return a.length ? String(a[0]) : null;
        }
        if (Array.isArray(v)) return v.length ? String(v[0]) : null;
        if (typeof v === "object") return null;
        return String(v);
    }

    /**
     * Desired zoom focus based on the active filters: the deepest node of the
     * path that has children (we don't zoom into a leaf).
     * Returns its key ("" = root).
     */
    function desiredFocusKey(): string {
        if (!rootNode) return "";
        const state = filters.activeFilters;
        let node: RectNode = rootNode;
        for (let depth = 1; depth <= MAX_DEPTH; depth++) {
            const key = keyByDepth[depth];
            const name = key ? scalarName(state[key]) : null;
            if (name == null) break;
            const child = (node.children as RectNode[] | undefined)?.find(
                (c) => c.data.name === name && !c.data.isOther,
            );
            if (!child || !child.children || child.children.length === 0) break;
            node = child;
        }
        return node.depth === 0 ? "" : nodeKey(node);
    }

    function positionTooltip(event: PointerEvent) {
        if (!hostEl) return;
        const rect = hostEl.getBoundingClientRect();
        let x = event.clientX - rect.left + 14;
        let y = event.clientY - rect.top + 14;
        const tw = 240;
        const th = 56;
        if (x + tw > rect.width) x = event.clientX - rect.left - tw - 14;
        if (y + th > rect.height) y = event.clientY - rect.top - th - 14;
        tooltip.x = Math.max(0, x);
        tooltip.y = Math.max(0, y);
    }

    function showTooltip(event: PointerEvent, d: RectNode) {
        tooltip.path = d
            .ancestors()
            .map((a) => a.data.name)
            .reverse()
            .join(" → ");
        tooltip.value = formatValue(d.value ?? 0);
        tooltip.openable = !d.data.isOther && !!canOpen && canOpen(d.data);
        tooltip.visible = true;
        positionTooltip(event);
    }

    function moveTooltip(event: PointerEvent) {
        positionTooltip(event);
    }

    function hideTooltip() {
        tooltip.visible = false;
    }

    function fillColor(d: RectNode): string {
        if (d.data.isOther) return SUNBURST_OTHER_COLOR;
        let node: RectNode = d;
        while (node.depth > 1) node = node.parent as RectNode;
        return colorScale(node.data.name);
    }

    /** Creates an arc (listeners + color + starting position). Shared by render/zoom. */
    function configureArcEnter(
        enter: d3.Selection<d3.EnterElement, RectNode, SVGGElement, unknown>,
        arc: d3.Arc<unknown, ArcDatum>,
    ): ArcSel {
        return enter
            .append("path")
            .style("cursor", (d) => (d.data.isOther ? null : "pointer"))
            .on("click", (event, p) => onArcClick(event as MouseEvent, p))
            .on("pointerenter", (event, d) =>
                showTooltip(event as PointerEvent, d),
            )
            .on("pointermove", (event) => moveTooltip(event as PointerEvent))
            .on("pointerleave", hideTooltip)
            .attr("fill", fillColor)
            .attr("d", (d) => arc(d.current) ?? "");
    }

    function render() {
        if (!svgEl) return;
        const colors = vizColors();
        const svg = d3.select(svgEl);

        if (!hasData) {
            svg.selectAll("*").remove();
            pathSel = labelSel = null;
            centerNameSel = centerValueSel = centerCircleSel = null;
            return;
        }

        const bucketed = bucketByDegree(data, 0, otherLabels);
        const w = chartSize;
        const radius = w / 6;

        const hierarchy = d3
            .hierarchy<SunburstNode>(bucketed)
            .sum((d) => d.value ?? 0)
            .sort(
                (a, b) =>
                    Number(a.data.isOther ?? false) -
                        Number(b.data.isOther ?? false) ||
                    (b.value ?? 0) - (a.value ?? 0),
            );
        const root = d3
            .partition<SunburstNode>()
            .size([2 * Math.PI, hierarchy.height + 1])(hierarchy) as RectNode;
        rootNode = root;

        // Find the current zoom focus in the new hierarchy (the brush may have
        // rebuilt the nodes); otherwise fall back to the root.
        let focus: RectNode = root;
        if (focusKey) {
            const found = (root.descendants() as RectNode[]).find(
                (d) => nodeKey(d) === focusKey,
            );
            if (found) focus = found;
            else focusKey = "";
        }
        focusNode = focus;
        root.each((d) => ((d as RectNode).current = transformArc(d, focus)));

        const arc = makeArc(radius);

        svg.attr("viewBox", [-w / 2, -w / 2, w, w])
            .attr("width", w)
            .attr("height", w)
            .style("font", "11px sans-serif");

        // Persistent groups: created once, then updated by a keyed data-join.
        let gArcs = svg.select<SVGGElement>("g.arcs");
        if (gArcs.empty()) gArcs = svg.append("g").attr("class", "arcs");
        let gLabels = svg.select<SVGGElement>("g.labels");
        if (gLabels.empty())
            gLabels = svg
                .append("g")
                .attr("class", "labels")
                .attr("pointer-events", "none")
                .attr("text-anchor", "middle")
                .style("user-select", "none");
        gLabels.attr("fill", colors.foreground);
        labelGroupSel = gLabels;

        // Stop any ongoing zoom transition before rebinding.
        gArcs.selectAll("path").interrupt();
        gLabels.selectAll("text").interrupt();

        // Lean DOM: we only materialize the arcs visible at the current focus.
        const nodes = root.descendants().slice(1) as RectNode[];
        const visibleNodes = nodes.filter((d) => arcVisible(d.current));

        const path = gArcs
            .selectAll<SVGPathElement, RectNode>("path")
            .data(visibleNodes, nodeKey as any)
            .join(
                (enter) => configureArcEnter(enter, arc),
                (update) => update,
                (exit) => exit.remove(),
            )
            .attr("fill", fillColor)
            .attr("pointer-events", "auto")
            .attr("d", (d) => arc(d.current));

        const labelNodes = visibleNodes.filter((d) => labelVisible(d.current));
        const label = gLabels
            .selectAll<SVGTextElement, RectNode>("text")
            .data(labelNodes, nodeKey as any)
            .join("text")
            .attr("dy", "0.35em")
            .attr("transform", (d) => labelTransform(d.current, radius))
            .text((d) => truncate(d.data.name, 22));

        let circle = svg.select<SVGCircleElement>("circle.center");
        if (circle.empty())
            circle = svg
                .append("circle")
                .attr("class", "center")
                .attr("pointer-events", "all")
                .on("click", onCenterClick);
        circle.attr("r", radius).attr("fill", colors.background);
        centerCircleSel = circle;

        let centerText = svg.select<SVGTextElement>("text.center");
        if (centerText.empty()) {
            centerText = svg
                .append("text")
                .attr("class", "center")
                .attr("pointer-events", "none")
                .attr("text-anchor", "middle");
            centerNameSel = centerText
                .append("tspan")
                .attr("x", 0)
                .attr("dy", "-0.1em")
                .attr("font-size", "14px")
                .attr("font-weight", "bold");
            centerValueSel = centerText
                .append("tspan")
                .attr("x", 0)
                .attr("dy", "1.6em")
                .attr("font-size", "11px")
                .attr("fill-opacity", 0.7);
        }
        centerText.attr("fill", colors.foreground);

        pathSel = path;
        labelSel = label;
        updateHighlight();
    }

    /**
     * Updates the highlight (opacities) + the center label without rebuilding the
     * SVG. We don't touch the opacities during a zoom transition.
     */
    function updateHighlight() {
        if (!pathSel || !labelSel) return;

        const focus = focusNode;
        centerNameSel?.text(
            focus && focus.depth > 0 ? truncate(focus.data.name, 22) : rootLabel,
        );
        centerValueSel?.text(formatValue((focus ?? null)?.value ?? 0));
        centerCircleSel?.style(
            "cursor",
            (focus && focus.depth > 0) ||
                hasSelection(filters.activeFilters)
                ? "pointer"
                : "default",
        );

        if (zooming) return;

        const state = filters.activeFilters;
        const selectionActive = hasSelection(state);

        pathSel.attr("fill-opacity", (d) => {
            if (!arcVisible(d.current)) return 0;
            const base = d.children ? 0.85 : 0.6;
            if (selectionActive && !nodeMatches(d, state)) return 0.12;
            return base;
        });

        labelSel.attr("fill-opacity", (d) =>
            labelVisible(d.current)
                ? selectionActive && !nodeMatches(d, state)
                    ? 0.25
                    : 1
                : 0,
        );
    }

    /**
     * Zooms (smooth transition) to center `focus`. Animates current → target on
     * the existing arcs, rebinds the visible labels to the target.
     */
    function zoomTo(focus: RectNode) {
        if (!svgEl || !rootNode || !labelGroupSel) return;
        const gArcs = d3.select(svgEl).select<SVGGElement>("g.arcs");
        if (gArcs.empty()) return;

        const fromFocus = focusNode ?? rootNode;
        const radius = chartSize / 6;
        const arc = makeArc(radius);

        rootNode.each((d) => ((d as RectNode).current = transformArc(d, fromFocus)));

        focusKey = focus.depth === 0 ? "" : nodeKey(focus);
        focusNode = focus;

        centerNameSel?.text(
            focus.depth > 0 ? truncate(focus.data.name, 22) : rootLabel,
        );
        centerValueSel?.text(formatValue(focus.value ?? 0));

        type TNode = RectNode & { target: ArcDatum };
        const unionNodes = (rootNode.descendants().slice(1) as RectNode[]).filter(
            (d) =>
                arcVisible(transformArc(d, fromFocus)) ||
                arcVisible(transformArc(d, focus)),
        );
        for (const d of unionNodes) (d as TNode).target = transformArc(d, focus);

        gArcs.selectAll("path").interrupt();
        labelGroupSel.selectAll("text").interrupt();

        const path = gArcs
            .selectAll<SVGPathElement, RectNode>("path")
            .data(unionNodes, nodeKey as any)
            .join(
                (enter) => configureArcEnter(enter, arc).attr("fill-opacity", 0),
                (update) => update,
                (exit) => exit.remove(),
            );
        pathSel = path;

        zooming = true;
        const token = ++zoomToken;
        const t = d3.select(svgEl).transition().duration(ZOOM_MS);

        const pathTr = path
            .transition(t as any)
            .tween("zoom", (d) => {
                const node = d as TNode;
                const i = d3.interpolate(node.current, node.target);
                return (time: number) => (node.current = i(time));
            })
            .attrTween("d", (d) => () => arc(d.current) ?? "")
            .attr("fill-opacity", (d) =>
                arcVisible((d as TNode).target) ? (d.children ? 0.85 : 0.6) : 0,
            )
            .attr("pointer-events", (d) =>
                arcVisible((d as TNode).target) ? "auto" : "none",
            );

        const labelData = unionNodes.filter((d) =>
            labelVisible((d as TNode).target),
        );
        labelGroupSel
            .selectAll<SVGTextElement, RectNode>("text")
            .data(labelData, nodeKey as any)
            .join(
                (enter) =>
                    enter
                        .append("text")
                        .attr("dy", "0.35em")
                        .attr("fill-opacity", 0)
                        .attr("transform", (d) =>
                            labelTransform((d as TNode).target, radius),
                        )
                        .text((d) => truncate(d.data.name, 22)),
                (update) => update,
                (exit) =>
                    exit.transition(t as any).attr("fill-opacity", 0).remove(),
            );
        const labels = labelGroupSel.selectAll<SVGTextElement, RectNode>("text");
        labels
            .transition(t as any)
            .attr("fill-opacity", (d) =>
                labelVisible((d as TNode).target) ? 1 : 0,
            )
            .attrTween(
                "transform",
                (d) => () => labelTransform(d.current, radius),
            );
        labelSel = labels;

        (pathTr as any)
            .end()
            .then(() => {
                if (token !== zoomToken) return;
                zooming = false;
                gArcs
                    .selectAll<SVGPathElement, RectNode>("path")
                    .filter((d) => !arcVisible(d.current))
                    .remove();
                labelGroupSel!
                    .selectAll<SVGTextElement, RectNode>("text")
                    .filter((d) => !labelVisible(d.current))
                    .remove();
                pathSel = gArcs.selectAll<SVGPathElement, RectNode>("path");
                labelSel = labelGroupSel!.selectAll<SVGTextElement, RectNode>(
                    "text",
                );
                updateHighlight();
            })
            .catch(() => {});
    }

    // Full SVG rebuild only when the data or the size changes.
    $effect(() => {
        const _data = data;
        const _size = chartSize;
        const _theme = themeStore.theme;
        render();
    });

    // The zoom follows the filter (source of truth).
    $effect(() => {
        const _filters = filters.activeFilters;
        if (!rootNode || !pathSel) return;
        const targetKey = desiredFocusKey();
        if (targetKey === focusKey) return;
        const target =
            targetKey === ""
                ? rootNode
                : (rootNode.descendants() as RectNode[]).find(
                      (d) => nodeKey(d) === targetKey,
                  );
        if (target) zoomTo(target);
    });

    // Filter change: we just update the opacities (no rebuild).
    $effect(() => {
        const _filters = filters.activeFilters;
        updateHighlight();
    });
</script>

<div class="sunburst-host" bind:this={hostEl}>
    {#if hasData}
        <svg bind:this={svgEl} data-testid={testId}></svg>
        {#if tooltip.visible}
            <div
                class="tooltip"
                style={`left:${tooltip.x}px; top:${tooltip.y}px;`}
            >
                <strong>{tooltip.path}</strong>
                <span>{tooltip.value}</span>
                {#if tooltip.openable && openHint}
                    <span class="hint">{openHint}</span>
                {/if}
            </div>
        {/if}
    {:else}
        <div class="empty">No data for this selection</div>
    {/if}
</div>

<style>
    .sunburst-host {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .tooltip {
        position: absolute;
        pointer-events: none;
        z-index: 3;
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-width: 15rem;
        border-radius: 7px;
        border: 1px solid hsl(var(--border));
        padding: 0.42rem 0.52rem;
        font-size: 0.72rem;
        line-height: 1.25;
        color: hsl(var(--foreground));
        background: color-mix(in srgb, hsl(var(--card)) 92%, black 8%);
    }

    .tooltip strong {
        font-weight: 600;
        word-break: break-word;
    }

    .tooltip span {
        opacity: 0.7;
    }

    .tooltip .hint {
        margin-top: 2px;
        font-size: 0.66rem;
        opacity: 1;
        color: var(--accent-spotify, #1db954);
    }

    .empty {
        width: 100%;
        height: 600px;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.5;
    }
</style>
