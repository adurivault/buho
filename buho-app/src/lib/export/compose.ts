/**
 * Flattening a live chart into a single canvas.
 *
 * The charts in this app are not one kind of thing: the races are stacked 2D
 * canvases, the constellation adds a WebGL layer, the D3 charts are an `<svg>`
 * with their legend and tooltip in plain HTML beside it. Rather than teach each of them to export itself, this walks the
 * subtree the caller points at and repaints what it finds — canvases as
 * bitmaps, SVGs through `rasterize.ts`, and the remaining HTML as the two
 * things chart chrome is actually made of: filled boxes and runs of text.
 *
 * It is a deliberately small renderer, not a browser. It does not do borders,
 * shadows, images or transforms, because no chart in this repo puts anything
 * load-bearing in them. Anything it cannot draw is simply absent from the
 * export rather than drawn wrong.
 *
 * Mark a node `data-export-hide` to keep it out — that is how the share
 * control keeps itself out of its own screenshots.
 */

import { svgToImage } from './rasterize';
import { vizColors } from '#lib/visualizations/themeColors.ts';

export type ComposeOptions = {
    /** Output pixels per CSS pixel. 2 gives a retina-sharp still. */
    scale?: number;
    /** Breathing room around the chart, in CSS pixels. */
    padding?: number;
    /** Plate colour behind everything. Defaults to the theme's card surface. */
    background?: string;
    /** Drawn above the chart, in the display face. */
    title?: string;
    /** Drawn under the title, muted. */
    caption?: string;
    /** Drawn bottom-right. `null` removes it. */
    credit?: string | null;
    /**
     * Repaints the chart's own layers, called immediately before they are read.
     *
     * A WebGL canvas only holds its pixels until the browser composites the
     * frame, so a chart with a GL layer has to be told to draw again right
     * before it is copied. This runs synchronously, in the same task as the
     * copy, which is the whole point of it.
     */
    prepare?: () => void;
};

export type Composer = {
    /** The surface frames are painted onto, in output pixels. */
    readonly canvas: HTMLCanvasElement;
    readonly width: number;
    readonly height: number;
    /** Repaints the plate from whatever the chart currently shows. */
    paint(): Promise<void>;
};

const TITLE_SIZE = 19;
const CAPTION_SIZE = 13;
const CREDIT_SIZE = 11;
const CREDIT_BAND = 26;

/**
 * Prepares a reusable plate for `element`.
 *
 * The geometry is measured once, at creation: an export must not resize
 * halfway through a recording just because the page reflowed behind it.
 */
export function createComposer(element: HTMLElement, options: ComposeOptions = {}): Composer {
    const { scale = 2, padding = 24, title, caption, credit = 'buho-app.com', prepare } = options;

    const theme = vizColors();
    const background = options.background ?? theme.background;

    const box = element.getBoundingClientRect();
    // The scrolled extent, not the visible one. Several charts are wider than a
    // phone and live inside their own horizontal scroller; exporting the slice
    // that happens to be on screen would cut the chart in half.
    const bodyWidth = Math.max(1, Math.round(Math.max(box.width, element.scrollWidth)));
    const bodyHeight = Math.max(1, Math.round(Math.max(box.height, element.scrollHeight)));

    const headHeight = (title ? TITLE_SIZE * 1.35 : 0) + (caption ? CAPTION_SIZE * 1.6 : 0);
    const footHeight = credit ? CREDIT_BAND : 0;

    const cssWidth = bodyWidth + padding * 2;
    const cssHeight = bodyHeight + padding * 2 + headHeight + footHeight;

    const canvas = document.createElement('canvas');
    // Even dimensions, always: H.264 encodes in 16×16 macroblocks and rejects an
    // odd width outright, which would make the video export fail on exactly the
    // charts whose layout happened to land on an odd pixel.
    canvas.width = even(cssWidth * scale);
    canvas.height = even(cssHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser refused a 2D canvas for the export.');

    const bodyTop = padding + headHeight;

    async function paint(): Promise<void> {
        const c = ctx!;
        c.setTransform(scale, 0, 0, scale, 0, 0);
        // Painted from the canvas's own size, not the CSS one: rounding the
        // buffer up to an even pixel would otherwise leave a transparent sliver
        // down the right edge, which a GIF renders as a black line.
        const plateWidth = canvas.width / scale;
        const plateHeight = canvas.height / scale;
        c.clearRect(0, 0, plateWidth, plateHeight);
        c.fillStyle = background;
        c.fillRect(0, 0, plateWidth, plateHeight);

        if (title) {
            c.fillStyle = theme.foreground;
            c.font = `600 ${TITLE_SIZE}px ${fontStack('--font-display')}`;
            c.textBaseline = 'top';
            c.fillText(title, padding, padding * 0.5);
        }
        if (caption) {
            c.fillStyle = theme.mutedForeground;
            c.font = `400 ${CAPTION_SIZE}px ${fontStack('--font-sans')}`;
            c.textBaseline = 'top';
            c.fillText(caption, padding, padding * 0.5 + (title ? TITLE_SIZE * 1.35 : 0));
        }

        c.save();
        c.beginPath();
        c.rect(padding, bodyTop, bodyWidth, bodyHeight);
        c.clip();
        // Children are laid out relative to the *scrolled* box, so the scroll
        // offset is added back to place them in content coordinates.
        c.translate(padding - box.left + element.scrollLeft, bodyTop - box.top + element.scrollTop);
        await paintSubtree(c, element, prepare);
        c.restore();

        if (credit) {
            c.fillStyle = theme.mutedForeground;
            c.globalAlpha = 0.65;
            c.font = `500 ${CREDIT_SIZE}px ${fontStack('--font-sans')}`;
            c.textAlign = 'right';
            c.textBaseline = 'alphabetic';
            c.fillText(credit, cssWidth - padding, cssHeight - padding * 0.45);
            c.textAlign = 'left';
            c.globalAlpha = 1;
        }
    }

    return { canvas, width: canvas.width, height: canvas.height, paint };
}

function even(value: number): number {
    return Math.max(2, Math.round(value / 2) * 2);
}

/** A theme font stack, with the web faces left in for the on-screen case. */
function fontStack(token: string): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    return value || 'system-ui, sans-serif';
}

/**
 * Draws `root` and its descendants into `ctx`, which the caller has already
 * translated so that viewport coordinates land in the right place.
 *
 * Two passes, because a single DOM-order pass would paint a label before the
 * pill it sits on: boxes and bitmaps first, then every run of text on top.
 */
async function paintSubtree(
    ctx: CanvasRenderingContext2D,
    root: HTMLElement,
    prepare?: () => void
): Promise<void> {
    const nodes = visibleElements(root);

    // The SVGs are rasterised together: each decode is a round trip through the
    // image pipeline, and a chart with a legend has several.
    const rasters = await Promise.all(
        nodes.map((node) =>
            node.el instanceof SVGSVGElement
                ? svgToImage(node.el, node.rect.width, node.rect.height).catch(() => null)
                : Promise.resolve(null)
        )
    );

    // The last thing before the pixels are read, and nothing may await after it.
    prepare?.();

    nodes.forEach((node, i) => {
        const { el, rect, opacity } = node;
        ctx.globalAlpha = opacity;

        if (el instanceof HTMLCanvasElement) {
            // A WebGL layer is only readable while its drawing buffer is still
            // alive; callers hand us the element straight after their own redraw,
            // so this stays inside the same task.
            if (el.width > 0 && el.height > 0) {
                ctx.drawImage(el, rect.left, rect.top, rect.width, rect.height);
            }
        } else if (rasters[i]) {
            ctx.drawImage(rasters[i]!, rect.left, rect.top, rect.width, rect.height);
        } else if (el instanceof HTMLElement) {
            paintBox(ctx, el, rect);
        }
        ctx.globalAlpha = 1;
    });

    paintText(ctx, root);
}

type VisibleNode = { el: Element; rect: DOMRect; opacity: number };

/**
 * The paintable elements of the subtree, in DOM order, with the inside of an
 * `<svg>` skipped: the whole SVG is rasterised in one piece, so descending into
 * it would draw everything twice.
 */
function visibleElements(root: HTMLElement): VisibleNode[] {
    const out: VisibleNode[] = [];

    const visit = (el: Element, inheritedOpacity: number) => {
        if (el instanceof HTMLElement && el.dataset.exportHide !== undefined) return;

        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;

        const opacity = inheritedOpacity * readOpacity(style);
        if (opacity <= 0.001) return;

        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) out.push({ el, rect, opacity });

        if (el instanceof SVGSVGElement) return;
        for (const child of el.children) visit(child, opacity);
    };

    visit(root, 1);
    return out;
}

/**
 * `opacity`, defaulting to opaque.
 *
 * A browser always resolves this to a number, but a computed style that came
 * back empty must not be read as `0` — that would drop the whole subtree from
 * the export rather than draw it faintly.
 */
function readOpacity(style: CSSStyleDeclaration): number {
    const value = Number(style.opacity);
    return Number.isFinite(value) && style.opacity !== '' ? value : 1;
}

/** The one piece of box decoration chart chrome actually uses. */
function paintBox(ctx: CanvasRenderingContext2D, el: HTMLElement, rect: DOMRect): void {
    const style = getComputedStyle(el);
    const fill = style.backgroundColor;
    if (!fill || fill === 'transparent' || fill === 'rgba(0, 0, 0, 0)') return;

    const radius = Math.min(
        parseFloat(style.borderTopLeftRadius) || 0,
        rect.width / 2,
        rect.height / 2
    );

    ctx.fillStyle = fill;
    ctx.beginPath();
    if (radius > 0) ctx.roundRect(rect.left, rect.top, rect.width, rect.height, radius);
    else ctx.rect(rect.left, rect.top, rect.width, rect.height);
    ctx.fill();
}

/**
 * Every run of text under `root`, drawn where the browser put it.
 *
 * The position comes from a `Range` over the text node rather than from its
 * parent's box, so a label wrapped across two lines lands as two runs in the
 * right two places, and a flex row of legend keys keeps its spacing.
 */
function paintText(ctx: CanvasRenderingContext2D, root: HTMLElement): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            // Text inside an SVG came along with the rasterised image.
            if (parent.closest('svg')) return NodeFilter.FILTER_REJECT;
            if (parent.closest('[data-export-hide]')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        },
    });

    const range = document.createRange();

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement!;
        const style = getComputedStyle(parent);
        if (style.visibility === 'hidden') continue;

        range.selectNodeContents(node);
        const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
        if (rects.length === 0) continue;

        ctx.font = shorthandFont(style);
        ctx.fillStyle = style.color;
        ctx.globalAlpha = readOpacity(style);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';

        // One rect per visual line; a single-line node gives exactly one.
        const lines = splitByLine(node.nodeValue ?? '', rects, ctx);
        for (const line of lines) {
            ctx.fillText(line.text, line.rect.left, baselineOf(ctx, line.rect));
        }
        ctx.globalAlpha = 1;
    }

    range.detach?.();
}

function shorthandFont(style: CSSStyleDeclaration): string {
    return `${style.fontStyle} ${style.fontWeight} ${style.fontSize}/${style.lineHeight === 'normal' ? style.fontSize : style.lineHeight} ${style.fontFamily}`;
}

/** Where the alphabetic baseline sits inside a line box. */
function baselineOf(ctx: CanvasRenderingContext2D, rect: DOMRect): number {
    const metrics = ctx.measureText('Mg');
    const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
    if (ascent && descent) {
        // Centre the face's own box in the line box the browser reported.
        return rect.top + (rect.height - (ascent + descent)) / 2 + ascent;
    }
    return rect.bottom - rect.height * 0.22;
}

/**
 * Splits a wrapped text node back into one string per line rect.
 *
 * Measured greedily against the rect widths: exactness is not the goal — a
 * legend key or an axis note is one line — but a wrapped paragraph must not
 * collapse into its first line repeated.
 */
function splitByLine(
    text: string,
    rects: DOMRect[],
    ctx: CanvasRenderingContext2D
): Array<{ text: string; rect: DOMRect }> {
    const trimmed = text.replace(/\s+/g, ' ');
    if (rects.length === 1) return [{ text: trimmed.trim(), rect: rects[0] }];

    const words = trimmed.trim().split(' ');
    const out: Array<{ text: string; rect: DOMRect }> = [];
    let cursor = 0;

    for (let i = 0; i < rects.length; i++) {
        const rect = rects[i];
        const last = i === rects.length - 1;
        let line = '';
        while (cursor < words.length) {
            const next = line ? `${line} ${words[cursor]}` : words[cursor];
            if (!last && line && ctx.measureText(next).width > rect.width) break;
            line = next;
            cursor++;
        }
        if (line) out.push({ text: line, rect });
    }

    return out;
}
