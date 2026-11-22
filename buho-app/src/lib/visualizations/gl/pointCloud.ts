import * as d3 from 'd3';

/**
 * WebGL renderer for the constellation's scatterplot.
 *
 * Why this exists: drawing the points with Canvas2D costs one `fillRect` call
 * per point. A JS loop over the same points takes ~4 ms, so the data is not the
 * problem — the ~200 ms it took on a 324 k-point export was the *API calls*
 * themselves. Long enough to swallow a d3 transition running elsewhere on the
 * page, since a transition advances on the clock rather than on frames.
 *
 * Here the whole scatterplot is two draw calls, whatever the point count.
 *
 * Deliberately free of any Svelte or component dependency: it owns a canvas and
 * some buffers, nothing else. The pure helpers below (`normalizePositions`,
 * `packColor`) carry the arithmetic worth testing; the GL calls themselves are
 * not reachable under jsdom, which is why the caller keeps a Canvas2D fallback.
 */

export type Domain = readonly [number, number];

/** Plot area in CSS pixels: [xLeft, xRight, yTop, yBottom]. */
export type PlotRect = readonly [number, number, number, number];

/**
 * Positions are uploaded **normalized to [0, 1]** over the full data domain.
 *
 * This is not a nicety: `x` is an epoch timestamp (~1.7e12) and a float32 holds
 * only ~7 significant digits, so raw timestamps would collapse points hours
 * apart onto the same coordinate. Normalizing puts every value in a range the
 * format resolves finely, and the visible window is applied in the shader.
 */
export function normalizePositions(
    points: readonly { x: number; y: number }[],
    xDomain: Domain,
    yDomain: Domain
): Float32Array {
    const out = new Float32Array(points.length * 2);
    const xSpan = xDomain[1] - xDomain[0] || 1;
    const ySpan = yDomain[1] - yDomain[0] || 1;
    for (let i = 0; i < points.length; i++) {
        out[i * 2] = (points[i].x - xDomain[0]) / xSpan;
        out[i * 2 + 1] = (points[i].y - yDomain[0]) / ySpan;
    }
    return out;
}

/** Where a value sits in a domain, as the shader's uniforms want it. */
export function normalizeDomain(window: Domain, full: Domain): [number, number] {
    const span = full[1] - full[0] || 1;
    return [(window[0] - full[0]) / span, (window[1] - full[0]) / span];
}

/** A CSS colour plus an alpha, as the four bytes an attribute buffer holds. */
export function packColor(css: string, alpha: number): [number, number, number, number] {
    const c = d3.rgb(css);
    const byte = (v: number) =>
        Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0;
    return [byte(c.r), byte(c.g), byte(c.b), byte(alpha * 255)];
}

/**
 * Per-point colours as one RGBA byte per channel.
 *
 * A colour attribute rather than a palette lookup in the shader: GLSL ES 1.0
 * only guarantees uniform-array indexing by constant expressions, so indexing a
 * palette by a per-vertex category would work on some drivers and not others.
 * Four bytes a point is 1.3 MB on a large export, uploaded only when the colour
 * dimension changes. Takes a callback rather than an array so the caller never
 * has to materialise one string per point.
 */
export function packColors(
    count: number,
    colorAt: (index: number) => string,
    alpha: number
): Uint8Array {
    const out = new Uint8Array(count * 4);
    const cache = new Map<string, [number, number, number, number]>();
    for (let i = 0; i < count; i++) {
        const css = colorAt(i);
        let rgba = cache.get(css);
        if (!rgba) {
            rgba = packColor(css, alpha);
            cache.set(css, rgba);
        }
        out[i * 4] = rgba[0];
        out[i * 4 + 1] = rgba[1];
        out[i * 4 + 2] = rgba[2];
        out[i * 4 + 3] = rgba[3];
    }
    return out;
}

// --- Shaders ---------------------------------------------------------------

/**
 * `uOnlyMatched` selects the pass. Points of the other pass are pushed outside
 * clip space instead of being drawn — two passes are needed because the matched
 * points must land on top of the dimmed ones, and a single call would paint in
 * buffer order.
 */
export const VERTEX_SHADER = `
attribute vec2 aPosition;
attribute float aMatched;
attribute vec4 aColor;

uniform vec4 uWindow;   // visible window, normalized: x0, x1, y0, y1
uniform vec4 uPlot;     // plot area in CSS px: left, right, top, bottom
uniform vec2 uCanvas;   // canvas size in CSS px
uniform float uPointSize;
uniform float uOnlyMatched;
uniform vec4 uDimColor;

varying vec4 vColor;

void main() {
    if (abs(aMatched - uOnlyMatched) > 0.5) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 0.0;
        return;
    }

    float tx = (aPosition.x - uWindow.x) / max(uWindow.y - uWindow.x, 1e-9);
    float ty = (aPosition.y - uWindow.z) / max(uWindow.w - uWindow.z, 1e-9);

    float px = mix(uPlot.x, uPlot.y, tx);
    float py = mix(uPlot.z, uPlot.w, ty);

    gl_Position = vec4(
        (px / uCanvas.x) * 2.0 - 1.0,
        1.0 - (py / uCanvas.y) * 2.0,
        0.0,
        1.0
    );
    gl_PointSize = uPointSize;
    vColor = uOnlyMatched > 0.5 ? aColor : uDimColor;
}
`;

/**
 * Round marks with a one-pixel soft edge.
 *
 * `gl.POINTS` rasterizes a hard square, whereas the Canvas2D path it replaces
 * drew a 2 px `fillRect` at fractional coordinates — anti-aliased, so it read as
 * a soft dot rather than a square. Fading the rim by a device pixel restores
 * that, and keeping the falloff in `gl_PointCoord` units scaled by `uPointSize`
 * makes it one pixel at any DPR.
 */
export const FRAGMENT_SHADER = `
precision mediump float;

// highp to match the vertex shader's default: a uniform both stages declare must
// agree on precision, or the program fails to link (ANGLE/Metal enforces it).
uniform highp float uPointSize;
varying vec4 vColor;

void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    float pixel = 1.0 / max(uPointSize, 1.0);
    float coverage = 1.0 - smoothstep(0.5 - pixel, 0.5, dist);
    if (coverage <= 0.0) discard;

    float alpha = vColor.a * coverage;
    gl_FragColor = vec4(vColor.rgb * alpha, alpha);
}
`;

// --- The renderer ----------------------------------------------------------

export interface DrawOptions {
    /** Visible window, in the same units as the domains given to `setPoints`. */
    xWindow: Domain;
    yWindow: Domain;
    plot: PlotRect;
    pointSize: number;
    dimColor: string;
    dimAlpha: number;
}

export interface PointCloud {
    setPoints(points: readonly { x: number; y: number }[], xDomain: Domain, yDomain: Domain): void;
    setMatched(matched: Uint8Array): void;
    setColors(colors: Uint8Array): void;
    resize(cssWidth: number, cssHeight: number, dpr: number): void;
    draw(options: DrawOptions): void;
    clear(): void;
    destroy(): void;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Point cloud shader failed to compile:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

/**
 * Build a renderer over `canvas`, or return null when WebGL is unavailable —
 * a browser with it disabled, a lost context, or jsdom under test. The caller
 * is expected to keep a Canvas2D path for that case.
 */
export function createPointCloud(canvas: HTMLCanvasElement): PointCloud | null {
    const gl = (canvas.getContext('webgl2', { antialias: false, alpha: true }) ??
        canvas.getContext('webgl', {
            antialias: false,
            alpha: true,
        })) as WebGLRenderingContext | null;
    if (!gl) return null;

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vertex || !fragment) return null;

    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Point cloud program failed to link:', gl.getProgramInfoLog(program));
        return null;
    }
    gl.useProgram(program);

    const loc = {
        position: gl.getAttribLocation(program, 'aPosition'),
        matched: gl.getAttribLocation(program, 'aMatched'),
        color: gl.getAttribLocation(program, 'aColor'),
        window: gl.getUniformLocation(program, 'uWindow'),
        plot: gl.getUniformLocation(program, 'uPlot'),
        canvas: gl.getUniformLocation(program, 'uCanvas'),
        pointSize: gl.getUniformLocation(program, 'uPointSize'),
        onlyMatched: gl.getUniformLocation(program, 'uOnlyMatched'),
        dimColor: gl.getUniformLocation(program, 'uDimColor'),
    };

    const positionBuffer = gl.createBuffer();
    const matchedBuffer = gl.createBuffer();
    const colorBuffer = gl.createBuffer();

    // Colours arrive premultiplied from the fragment shader, so the source
    // factor is ONE. This reproduces Canvas2D's alpha compositing, which is what
    // makes overlapping points accumulate into denser areas — the density
    // reading the chart relies on.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    let count = 0;
    let xDomain: Domain = [0, 1];
    let yDomain: Domain = [0, 1];
    let cssWidth = 0;
    let cssHeight = 0;

    function bindAttribute(
        buffer: WebGLBuffer | null,
        location: number,
        size: number,
        type: number,
        normalized: boolean
    ) {
        if (location < 0) return;
        gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
        gl!.enableVertexAttribArray(location);
        gl!.vertexAttribPointer(location, size, type, normalized, 0, 0);
    }

    return {
        setPoints(points, nextXDomain, nextYDomain) {
            count = points.length;
            xDomain = nextXDomain;
            yDomain = nextYDomain;
            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.bufferData(
                gl.ARRAY_BUFFER,
                normalizePositions(points, xDomain, yDomain),
                gl.STATIC_DRAW
            );
        },

        setMatched(matched) {
            gl.bindBuffer(gl.ARRAY_BUFFER, matchedBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, matched, gl.DYNAMIC_DRAW);
        },

        setColors(colors) {
            gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);
        },

        resize(nextCssWidth, nextCssHeight, dpr) {
            cssWidth = nextCssWidth;
            cssHeight = nextCssHeight;
            canvas.width = Math.round(nextCssWidth * dpr);
            canvas.height = Math.round(nextCssHeight * dpr);
            gl.viewport(0, 0, canvas.width, canvas.height);
        },

        clear() {
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        },

        draw(options) {
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            if (count === 0 || cssWidth === 0 || cssHeight === 0) return;

            gl.useProgram(program);
            bindAttribute(positionBuffer, loc.position, 2, gl.FLOAT, false);
            bindAttribute(matchedBuffer, loc.matched, 1, gl.UNSIGNED_BYTE, false);
            bindAttribute(colorBuffer, loc.color, 4, gl.UNSIGNED_BYTE, true);

            const [wx0, wx1] = normalizeDomain(options.xWindow, xDomain);
            const [wy0, wy1] = normalizeDomain(options.yWindow, yDomain);
            gl.uniform4f(loc.window, wx0, wx1, wy0, wy1);
            gl.uniform4f(
                loc.plot,
                ...(options.plot as unknown as [number, number, number, number])
            );
            gl.uniform2f(loc.canvas, cssWidth, cssHeight);
            gl.uniform1f(loc.pointSize, options.pointSize);

            const dim = packColor(options.dimColor, options.dimAlpha);
            gl.uniform4f(loc.dimColor, dim[0] / 255, dim[1] / 255, dim[2] / 255, dim[3] / 255);

            // Dimmed first, matched on top — the order the Canvas2D path used.
            gl.uniform1f(loc.onlyMatched, 0);
            gl.drawArrays(gl.POINTS, 0, count);
            gl.uniform1f(loc.onlyMatched, 1);
            gl.drawArrays(gl.POINTS, 0, count);
        },

        destroy() {
            gl.deleteBuffer(positionBuffer);
            gl.deleteBuffer(matchedBuffer);
            gl.deleteBuffer(colorBuffer);
            gl.deleteProgram(program);
            gl.deleteShader(vertex);
            gl.deleteShader(fragment);
        },
    };
}
