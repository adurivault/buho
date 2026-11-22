/**
 * Turning a live `<svg>` into pixels, without a server and without a canvas
 * library.
 *
 * The route is the standard one — serialise, wrap in a blob URL, decode it as
 * an image — with the two corrections that make it work on *our* charts:
 *
 *  - theme tokens are substituted in (see `cssVars.ts`), because the rasterised
 *    SVG is its own document and never sees `app.css`;
 *  - the inherited typography is pinned onto the clone, because an `<img>`
 *    inherits nothing from the page that produced it.
 *
 * The web fonts themselves cannot follow: an SVG loaded as an image is denied
 * network access, so `Inter` / `JetBrains Mono` fall through to
 * the system faces in their stacks. That is a small, deliberate difference
 * between what is on screen and what is exported; embedding the woff2 files
 * would mean fetching them at export time, which is not a trade worth making
 * for a share button.
 */

import { createTokenResolver, resolveCssVars } from './cssVars';

/** Properties an `<img>`-loaded SVG cannot inherit and our charts rely on. */
const INHERITED = [
    'color',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'letter-spacing',
    'font-variant-numeric',
] as const;

/**
 * Serialises `svg` to a decoded `HTMLImageElement` of `width` × `height` CSS
 * pixels. The caller scales when drawing, so one serialisation can be painted
 * at any output resolution.
 */
export async function svgToImage(
    svg: SVGElement,
    width: number,
    height: number
): Promise<HTMLImageElement> {
    const markup = serializeSvg(svg, width, height);
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
    try {
        const img = new Image();
        img.decoding = 'sync';
        img.src = url;
        await img.decode();
        return img;
    } finally {
        // Safe once `decode()` has resolved: the bitmap is already in memory.
        URL.revokeObjectURL(url);
    }
}

/** The standalone markup for `svg`, ready to be loaded as its own document. */
export function serializeSvg(svg: SVGElement, width: number, height: number): string {
    const clone = svg.cloneNode(true) as SVGElement;

    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    if (!clone.getAttribute('viewBox')) {
        clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }

    // Pinning `color` here is what keeps `currentColor` — which the charts' axes
    // lean on for their ink — resolving to the same shade it has on screen.
    const computed = getComputedStyle(svg);
    const pinned = INHERITED.map((prop) => `${prop}:${computed.getPropertyValue(prop)}`)
        .filter((decl) => !decl.endsWith(':'))
        .join(';');
    if (pinned) {
        clone.setAttribute('style', `${pinned};${clone.getAttribute('style') ?? ''}`);
    }

    const markup = new XMLSerializer().serializeToString(clone);
    return resolveCssVars(markup, createTokenResolver());
}
