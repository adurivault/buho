import { describe, expect, it } from 'vitest';
import { serializeSvg } from './rasterize';

function svgWith(inner: string): SVGElement {
    const host = document.createElement('div');
    host.innerHTML = `<svg>${inner}</svg>`;
    const svg = host.querySelector('svg')!;
    document.body.appendChild(host);
    return svg;
}

describe('serializeSvg', () => {
    it('declares the namespace, so the markup stands alone', () => {
        const markup = serializeSvg(svgWith(''), 400, 200);
        expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"');
    });

    it('states the size it was asked for', () => {
        const markup = serializeSvg(svgWith(''), 400, 200);
        expect(markup).toContain('width="400"');
        expect(markup).toContain('height="200"');
    });

    it('gives an SVG without one a viewBox covering the same size', () => {
        expect(serializeSvg(svgWith(''), 400, 200)).toContain('viewBox="0 0 400 200"');
    });

    it('keeps a viewBox the chart already chose', () => {
        const svg = svgWith('');
        svg.setAttribute('viewBox', '0 0 10 10');
        expect(serializeSvg(svg, 400, 200)).toContain('viewBox="0 0 10 10"');
    });

    it('substitutes theme tokens, which the rasterised copy cannot look up', () => {
        document.documentElement.style.setProperty('--foreground', '40 16% 90%');
        const markup = serializeSvg(
            svgWith('<path fill="hsl(var(--foreground))" d="M0,0H1Z"/>'),
            10,
            10
        );
        expect(markup).toContain('hsl(40 16% 90%)');
        expect(markup).not.toContain('var(--foreground)');
    });

    it('leaves the live chart alone', () => {
        const svg = svgWith('');
        serializeSvg(svg, 400, 200);
        expect(svg.getAttribute('width')).toBeNull();
    });
});
