import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';

/**
 * Capture one explorer chart per module, from the demo data, for the module
 * welcomes and the home tiles.
 *
 *   npm run shots    # builds, then writes static/shots/<module>-<theme>.webp
 *
 * Re-run it when a captured chart changes, and commit the files.
 *
 * A capture is a file sent to every visitor, so it only ever shows the demo:
 * each page goes through the module's own "Load demo data" button, the road a
 * visitor takes, and the browser is refused every host but the local server.
 *
 * The build is served rather than the dev server so the capture is what ships.
 * Playwright only writes PNG, so each capture is scaled and re-encoded to WebP by
 * the same Chromium, in a blank page, which spares an image library.
 */

const OUT = new URL('../static/shots/', import.meta.url);

/** Light and dark, through the system preference the app follows on load. */
const THEMES = ['light', 'dark'];

/**
 * A laptop window, where the explorers lay out as designed, at 1.5× pixel
 * density. The welcome card shows a chart at about three quarters of its size,
 * so that is twice the pixels it is shown at: sharp on a high-DPI screen. At
 * 2× the constellation draws its points one CSS pixel wide, and shrunk into
 * the card they all but disappear.
 */
const VIEWPORT = { width: 1280, height: 800 };
const SCALE = 1.5;

/**
 * The widest a capture is kept: twice the welcome card at its largest, which
 * is the biggest it is ever shown. Wider would only weigh more; the browser
 * would shrink it the same way on screen.
 */
const MAX_WIDTH = 1200;
const QUALITY = 0.7;

/**
 * The region captured on each module's explorer: its main chart, without the
 * toolbar above it. `.constellation-layout` is the plate a shared image is cut
 * from, so it is already framed as a picture.
 *
 * The health raster takes the window's width; a narrower window gives it the
 * proportions of the others instead of a long strip.
 */
const MODULES = {
    listening: { region: '.constellation-layout' },
    positions: { region: '.constellation-layout' },
    messages: { region: '.constellation-layout' },
    activity: { region: '.constellation-layout' },
    steps: { region: '.constellation-layout' },
    health: { region: '.chart', viewport: { width: 960, height: 800 } },
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const server = await preview({ preview: { port: 4183, open: false }, logLevel: 'warn' });
const origin = server.resolvedUrls?.local[0];
if (!origin) throw new Error('The preview server did not report a local address');

const browser = await chromium.launch();
const encoder = await browser.newPage();
await mkdir(OUT, { recursive: true });

try {
    for (const theme of THEMES) {
        const context = await browser.newContext({
            viewport: VIEWPORT,
            deviceScaleFactor: SCALE,
            colorScheme: theme,
            reducedMotion: 'reduce',
            serviceWorkers: 'block',
        });
        await context.route(
            (url) => !LOCAL_HOSTS.has(url.hostname),
            (route) => route.abort()
        );

        for (const [module, { region, viewport }] of Object.entries(MODULES)) {
            const page = await context.newPage();
            if (viewport) await page.setViewportSize(viewport);
            const png = await capture(page, `${origin}${module}/explore`, region);
            const webp = await toWebp(png);
            const file = new URL(`${module}-${theme}.webp`, OUT);
            await writeFile(file, webp);
            console.log(`${module}-${theme}.webp  ${Math.round(webp.length / 1024)} KB`);
            await page.close();
        }
        await context.close();
    }
} finally {
    await browser.close();
    await server.close();
}

/** Load the module's demo on its explorer, wait for the chart, capture it. */
async function capture(page, url, region) {
    await page.goto(url);
    await page.getByRole('button', { name: 'Load demo data' }).click();
    // Off the chart, so no point is hovered and no tooltip is drawn.
    await page.mouse.move(0, 0);

    const chart = page.locator(region).first();
    await chart.waitFor({ state: 'visible', timeout: 120_000 });
    await page.waitForFunction(() => !document.querySelector('.loading-wrapper'));
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    // The view's own controls float over the plate.
    await page.addStyleTag({ content: '.plot-toolbar { visibility: hidden !important; }' });
    // The last redraws after the queries land: brush layers, the WebGL points.
    await page.waitForTimeout(2000);

    return chart.screenshot({ animations: 'disabled' });
}

async function toWebp(png) {
    const base64 = await encoder.evaluate(
        async ({ data, quality, maxWidth }) => {
            const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
            const bitmap = await createImageBitmap(blob);
            const scale = Math.min(1, maxWidth / bitmap.width);
            const width = Math.round(bitmap.width * scale);
            const height = Math.round(bitmap.height * scale);
            const canvas = new OffscreenCanvas(width, height);
            const context = canvas.getContext('2d');
            context.imageSmoothingQuality = 'high';
            context.drawImage(bitmap, 0, 0, width, height);
            const webp = await canvas.convertToBlob({ type: 'image/webp', quality });
            const bytes = new Uint8Array(await webp.arrayBuffer());
            let binary = '';
            for (const byte of bytes) binary += String.fromCharCode(byte);
            return btoa(binary);
        },
        { data: png.toString('base64'), quality: QUALITY, maxWidth: MAX_WIDTH }
    );
    return Buffer.from(base64, 'base64');
}
