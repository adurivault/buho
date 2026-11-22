import * as d3 from 'd3';
import type { MonthlyCohortPoint } from '#lib/data/queries/discoveryQueries.ts';
import { styleAxis } from './chart';

/**
 * Discovery "sediment" chart, in hand-rolled D3.
 *
 * - One stacked column per month; within a column, layers are ordered by discovery cohort, oldest
 *   at the bottom (sediment). No interpolation between months → crisp columns, no sawtooth.
 * - Each layer is coloured by its age relative to the playhead (`nowTime`): the listening accent
 *   when just discovered, fading towards its tint once old. As the playhead advances the whole
 *   past fades.
 * - Axes grow with the playhead on x (the visible window expands month by month) and stay pinned on
 *   y (the tallest monthly column), so the chart reads like a bar-chart race building up.
 *
 * The factory builds the SVG / scales / legend / tooltip once; `update()` redraws via data-joins,
 * so calling it every animation frame is cheap.
 */

const DAY_MS = 86_400_000;
const HEIGHT = 380;
const MARGIN = { top: 56, right: 20, bottom: 34, left: 56 };
const LEGEND_WIDTH = 220;
/**
 * Fresh (0) to old (1): the listening peak fading into its tint. CSS, so a theme
 * toggle repaints it without a redraw; the tint stays a step clear of the surface.
 */
const ageInterp = (u: number) =>
    `color-mix(in lab, var(--peak-listening) ${Math.round(100 - 88 * u)}%, var(--accent-listening-soft))`;

function formatAgeDays(days: number): string {
    if (days < 1) return '0';
    if (days < 60) return `${Math.round(days)}d`;
    if (days < 365) return `${Math.round(days / 30)}mo`;
    const years = days / 365;
    return `${years.toFixed(years < 10 ? 1 : 0)}y`;
}

/**
 * - `discovery`: colour = discovery date, over the revealed window [oldest discovery, playhead].
 *   The scale (and legend) grows with the playhead; oldest = tint, freshest = accent.
 * - `age`: colour = the track's age at the moment it was played (play month − discovery), on a
 *   fixed age scale; just-discovered = accent, long-owned = tint.
 */
export type SedimentColorMode = 'discovery' | 'age';

export interface SedimentUpdateOptions {
    width: number;
    nowTime?: number | null;
    colorMode?: SedimentColorMode;
}

export interface SedimentChart {
    update(data: MonthlyCohortPoint[], options: SedimentUpdateOptions): void;
    destroy(): void;
}

export function createDiscoverySediment(container: HTMLElement): SedimentChart {
    container.style.position = 'relative';

    const svg = d3
        .select(container)
        .append('svg')
        .attr('class', 'chart-svg')
        .attr('height', HEIGHT);

    // Two horizontal gradients (unique ids so instances don't collide). The legends read left→right:
    // the date legend runs old→recent (tint→accent); the age legend runs fresh→old (accent→tint).
    const defs = svg.append('defs');
    const suffix = Math.random().toString(36).slice(2);
    const gradDateId = `grad-date-${suffix}`;
    const gradAgeId = `grad-age-${suffix}`;
    const buildGradient = (id: string, colorAt: (t: number) => string) => {
        const g = defs.append('linearGradient').attr('id', id).attr('x1', '0%').attr('x2', '100%');
        d3.range(0, 1.0001, 0.1).forEach((t) => {
            g.append('stop')
                .attr('offset', `${t * 100}%`)
                .attr('stop-color', colorAt(t));
        });
    };
    buildGradient(gradDateId, (t) => ageInterp(1 - t)); // old → recent
    buildGradient(gradAgeId, (t) => ageInterp(t)); // fresh → old

    const gGrid = svg.append('g').attr('class', 'y-grid');
    const gBars = svg.append('g').attr('class', 'bars');
    const gX = svg.append('g').attr('class', 'x-axis');
    const gY = svg.append('g').attr('class', 'y-axis');
    const gLegend = svg.append('g').attr('class', 'legend');

    const tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    tip.hidden = true;
    tip.dataset.exportHide = '';
    // Centred above the pointer, clear of the column it describes.
    tip.style.transform = 'translate(-50%, calc(-100% - 12px))';
    container.appendChild(tip);

    function clearMarks() {
        gBars.selectAll('*').remove();
        gX.selectAll('*').remove();
        gY.selectAll('*').remove();
        gGrid.selectAll('*').remove();
        gLegend.selectAll('*').remove();
    }

    function update(data: MonthlyCohortPoint[], opts: SedimentUpdateOptions) {
        const width = Math.max(320, Math.floor(opts.width));
        svg.attr('width', width).attr('viewBox', `0 0 ${width} ${HEIGHT}`);

        if (!data.length) {
            clearMarks();
            tip.hidden = true;
            return;
        }

        const plotLeft = MARGIN.left;
        const plotRight = width - MARGIN.right;
        const plotTop = MARGIN.top;
        const plotBottom = HEIGHT - MARGIN.bottom;

        const rows = data.map((d) => ({
            monthTime: new Date(`${d.month}T00:00:00`).getTime(),
            cohortTime: new Date(`${d.cohort}T00:00:00`).getTime(),
            plays: d.plays,
        }));

        const firstMonth = d3.min(rows, (r) => r.monthTime) ?? 0;
        const lastMonth = d3.max(rows, (r) => r.monthTime) ?? 1;
        const minCohort = d3.min(rows, (r) => r.cohortTime) ?? firstMonth;
        const maxMonthlyPlays =
            d3.max(
                d3
                    .rollup(
                        rows,
                        (v) => d3.sum(v, (r) => r.plays),
                        (r) => r.monthTime
                    )
                    .values()
            ) ?? 1;

        const mode: SedimentColorMode = opts.colorMode ?? 'discovery';

        // Playhead: clamp to range, default to the end (settled full chart).
        const now = Math.min(lastMonth, Math.max(firstMonth, opts.nowTime ?? lastMonth));

        // `discovery`: colour = discovery date over the revealed window [oldest discovery, now],
        // which grows with the playhead (oldest = tint, freshest = accent).
        // `age`: colour = the track's age when played (play month − discovery) on a fixed scale
        // (just-discovered = accent, long-owned = tint).
        const span = Math.max(DAY_MS, now - minCohort);
        const maxAgeDays = Math.max(
            1,
            (d3.max(rows, (r) => r.monthTime - r.cohortTime) ?? 0) / DAY_MS
        );
        const colorOf = (s: { monthTime: number; cohortTime: number }) =>
            mode === 'age'
                ? ageInterp(Math.min(1, (s.monthTime - s.cohortTime) / DAY_MS / maxAgeDays))
                : ageInterp(Math.min(1, Math.max(0, (now - s.cohortTime) / span)));

        // Build stacked segments for the visible months (oldest cohort at the bottom).
        type Seg = {
            monthTime: number;
            cohortTime: number;
            y0: number;
            y1: number;
            plays: number;
        };
        const segments: Seg[] = [];
        const byMonth = d3.group(
            rows.filter((r) => r.monthTime <= now),
            (r) => r.monthTime
        );
        for (const [monthTime, list] of byMonth) {
            list.sort((a, b) => a.cohortTime - b.cohortTime); // oldest first → bottom
            let acc = 0;
            for (const r of list) {
                const y0 = acc;
                acc += r.plays;
                segments.push({
                    monthTime,
                    cohortTime: r.cohortTime,
                    y0,
                    y1: acc,
                    plays: r.plays,
                });
            }
        }

        // x grows with the playhead; y is pinned to the tallest column.
        const x = d3
            .scaleTime()
            .domain([firstMonth, d3.timeMonth.offset(new Date(now), 1).getTime()])
            .range([plotLeft, plotRight]);
        const y = d3.scaleLinear().domain([0, maxMonthlyPlays]).range([plotBottom, plotTop]);

        const monthWidth = (mt: number) => {
            const w = x(d3.timeMonth.offset(new Date(mt), 1).getTime()) - x(mt);
            return Math.max(0.5, w - 0.5);
        };

        // Grid (horizontal lines).
        gGrid.attr('transform', `translate(${plotLeft},0)`).call(
            d3
                .axisLeft(y)
                .ticks(5)
                .tickSize(-(plotRight - plotLeft))
                .tickFormat(() => '')
        );
        styleAxis(gGrid, true);

        // Axes.
        gX.attr('transform', `translate(0,${plotBottom})`).call(
            d3.axisBottom(x).ticks(Math.max(2, Math.floor(width / 120)))
        );
        styleAxis(gX);
        gY.attr('transform', `translate(${plotLeft},0)`).call(
            d3.axisLeft(y).ticks(5).tickFormat(d3.format('~s'))
        );
        styleAxis(gY);

        // Bars (one rect per cohort layer), keyed so joins are stable across frames.
        gBars
            .selectAll<SVGRectElement, Seg>('rect')
            .data(segments, (d) => `${d.monthTime}:${d.cohortTime}`)
            .join('rect')
            .attr('x', (d) => x(d.monthTime))
            .attr('width', (d) => monthWidth(d.monthTime))
            .attr('y', (d) => y(d.y1))
            .attr('height', (d) => Math.max(0, y(d.y0) - y(d.y1)))
            .attr('fill', (d) => colorOf(d))
            .attr('stroke', (d) => colorOf(d)) // same colour → hides seams
            .attr('stroke-width', 1)
            .on('mousemove', (event: MouseEvent, d) => {
                const [mx, my] = d3.pointer(event, container);
                const monthLabel = new Date(d.monthTime).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                });
                const cohortLabel = new Date(d.cohortTime).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                });
                const ageLabel = formatAgeDays((d.monthTime - d.cohortTime) / DAY_MS);
                const title = document.createElement('strong');
                title.textContent = monthLabel;
                const rows = [
                    `Discovered in ${cohortLabel} (${ageLabel} ago)`,
                    `${d.plays.toLocaleString()} plays`,
                ].map((line) => {
                    const row = document.createElement('span');
                    row.textContent = line;
                    return row;
                });
                tip.replaceChildren(title, ...rows);
                tip.hidden = false;
                tip.style.left = `${mx}px`;
                tip.style.top = `${my}px`;
            })
            .on('mouseleave', () => (tip.hidden = true));

        // Legend depends on the colour mode.
        gLegend.selectAll('*').remove();
        gLegend.attr('transform', `translate(${plotLeft},14)`);
        gLegend
            .append('text')
            .attr('y', 0)
            .attr('fill', 'currentColor')
            .text(mode === 'age' ? 'Track age at listen time' : 'Track discovery date');
        gLegend
            .append('rect')
            .attr('y', 8)
            .attr('width', LEGEND_WIDTH)
            .attr('height', 8)
            .attr('rx', 2)
            .attr('fill', `url(#${mode === 'age' ? gradAgeId : gradDateId})`);

        let legendAxisGen: d3.Axis<d3.NumberValue>;
        if (mode === 'age') {
            // Fixed age axis: 0 (just discovered) → maxAge (long-owned).
            const ageScale = d3.scaleLinear().domain([0, maxAgeDays]).range([0, LEGEND_WIDTH]);
            legendAxisGen = d3
                .axisBottom(ageScale)
                .ticks(4)
                .tickSize(3)
                .tickFormat((d) => formatAgeDays(d as number));
        } else {
            // Date axis over [oldest discovery, playhead], growing with the animation.
            const legendEnd = Math.max(now, minCohort + DAY_MS);
            const wideSpan = legendEnd - minCohort > 2 * 365 * DAY_MS;
            const dateScale = d3
                .scaleTime()
                .domain([minCohort, legendEnd])
                .range([0, LEGEND_WIDTH]);
            legendAxisGen = d3
                .axisBottom(dateScale)
                .ticks(3)
                .tickSize(3)
                .tickFormat((d) =>
                    new Date(d.valueOf()).toLocaleDateString(
                        undefined,
                        wideSpan ? { year: 'numeric' } : { year: 'numeric', month: 'short' }
                    )
                ) as unknown as d3.Axis<d3.NumberValue>;
        }
        const legendAxis = gLegend
            .append('g')
            .attr('transform', 'translate(0,16)')
            .call(legendAxisGen);
        styleAxis(legendAxis);
    }

    function destroy() {
        svg.remove();
        tip.remove();
    }

    return { update, destroy };
}
