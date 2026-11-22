import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';

/**
 * Capture the explorer charts the welcomes and the home tiles show, from the
 * demo data, in both themes.
 *
 *   npm run shots                          # builds, then writes static/shots/<file>-<theme>.webp
 *   node scripts/shots.mjs positions health  # only those pages, from the last build
 *
 * Re-run it when a captured chart changes, and commit the files. What the
 * pages show of them is `src/lib/shots.ts`; its test fails if a file it names
 * is missing. A new capture goes here first and into `shots.ts` once its file
 * exists: the build follows every image a page links, and fails on one that
 * is not there.
 *
 * A capture is a file sent to every visitor, so it only ever shows the demo:
 * each page goes through its own "Load demo data" button, the road a visitor
 * takes. The browser is refused every host but the local server and the map
 * tiles, which only ever receive the map's view, as in the app.
 *
 * The build is served rather than the dev server so the capture is what ships.
 * Playwright only writes PNG, so each capture is scaled and re-encoded to WebP
 * by the same Chromium, in a blank page, which spares an image library.
 */

const OUT = new URL('../static/shots/', import.meta.url);

/** Light and dark, through the system preference the app follows on load. */
const THEMES = ['light', 'dark'];

/**
 * A laptop window, where the explorers lay out as designed, at 1.5× pixel
 * density. A welcome card shows a chart at about three quarters of its size,
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
 * A whole explorer page is only ever shown as a home tile, under 400 CSS
 * pixels wide: twice that is all it needs.
 */
const PAGE_WIDTH = 800;

const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'tiles.openfreemap.org']);

/**
 * Where the positions map is framed for its capture: the city the demo lives
 * in, at a zoom that holds it whole. The app fits the whole history instead,
 * trips included, which is a country; that stays the app's behaviour, and
 * only the capture is framed here.
 */
const DEMO_CITY = { center: [2.352, 48.849], zoom: 10.15 };

/**
 * Each page, and what is captured on it. `region` is the element captured;
 * `before` sets the view up first, `viewport` resizes the window for it, and
 * `maxWidth` caps the file's width. Each explorer gives the whole page, for
 * the home's tiles, then its main chart (the constellation is the plate a
 * shared image is cut from, so it is already framed as a picture) and a
 * second one of another kind, for its welcome.
 */
const wholePage = (module) => ({
    file: `${module}-page`,
    region: 'main.main-content',
    maxWidth: PAGE_WIDTH,
    before: hideHeaderPill,
});

/**
 * The health raster takes the window's width; a narrower window gives it the
 * proportions of the other charts instead of a long strip.
 */
const NARROW = { width: 960, height: 800 };

const PAGES = [
    {
        path: 'listening/explore',
        shots: [
            wholePage('listening'),
            { file: 'listening-constellation', region: '.constellation-layout' },
            { file: 'listening-artists', region: '.chart-placeholder.sunburst' },
        ],
    },
    {
        path: 'positions/explore',
        shots: [
            wholePage('positions'),
            { file: 'positions-constellation', region: '.constellation-layout' },
            { file: 'positions-map', region: 'aside .sunburst-host', before: frameDemoCity },
        ],
    },
    {
        path: 'messages/explore',
        shots: [
            wholePage('messages'),
            { file: 'messages-constellation', region: '.constellation-layout' },
            { file: 'messages-conversations', region: '.chart-placeholder.ranking' },
        ],
    },
    {
        path: 'activity/explore',
        shots: [
            wholePage('activity'),
            { file: 'activity-constellation', region: '.constellation-layout' },
            { file: 'activity-services', region: '.chart-placeholder.ranking' },
        ],
    },
    {
        path: 'steps/explore',
        shots: [
            wholePage('steps'),
            { file: 'steps-constellation', region: '.constellation-layout' },
            { file: 'steps-cadence', region: '.chart-placeholder.ranking' },
        ],
    },
    {
        path: 'health/explore',
        shots: [
            wholePage('health'),
            { file: 'health-heart-rate', region: '.chart', viewport: NARROW },
            {
                file: 'health-stress',
                region: '.chart',
                viewport: NARROW,
                before: (tab) => signal(tab, 'Stress'),
            },
        ],
    },
    {
        path: 'calendar',
        shots: [
            { file: 'calendar-year', region: '.lanes' },
            { file: 'calendar-clock', region: 'figure.year-clock' },
        ],
    },
];

const only = process.argv.slice(2);
const pages = only.length ? PAGES.filter(({ path }) => only.includes(path.split('/')[0])) : PAGES;

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
            (url) => !ALLOWED_HOSTS.has(url.hostname),
            (route) => route.abort()
        );
        await exposeMaps(context);

        for (const { path, shots } of pages) {
            const tab = await context.newPage();
            await loadDemo(tab, `${origin}${path}`, shots[0].region);

            for (const { file, region, before, viewport, maxWidth = MAX_WIDTH } of shots) {
                if (viewport) await tab.setViewportSize(viewport);
                if (before) await before(tab, region);
                await settle(tab);
                const png = await tab
                    .locator(region)
                    .first()
                    .screenshot({ animations: 'disabled' });
                const webp = await toWebp(png, maxWidth);
                await writeFile(new URL(`${file}-${theme}.webp`, OUT), webp);
                console.log(`${file}-${theme}.webp  ${Math.round(webp.length / 1024)} KB`);
            }
            await tab.close();
        }
        await context.close();
    }
} finally {
    await browser.close();
    await server.close();
}

/** Open the page, press its demo button, and wait until every sample is in. */
async function loadDemo(page, url, region) {
    await page.goto(url);
    await page.getByRole('button', { name: 'Load demo data' }).click();
    // Off the charts, so no point is hovered and no tooltip is drawn.
    await page.mouse.move(0, 0);
    await page.locator(region).first().waitFor({ state: 'visible', timeout: 300_000 });
    await page.waitForFunction(
        () => {
            const text = document.body.innerText;
            return (
                // The page's welcome gives way once a sample is in.
                !document.querySelector('.welcome') &&
                !document.querySelector('.loading-wrapper') &&
                !text.includes('Building the sample') &&
                !text.includes('Locating points') &&
                // The calendar loads the samples one after the other.
                !text.includes('Not imported')
            );
        },
        null,
        { timeout: 300_000 }
    );
    // The views' own controls float over the charts.
    await page.addStyleTag({ content: '.plot-toolbar { visibility: hidden !important; }' });
}

/** The header's import pill: it speaks to a visitor, not about the page. */
async function hideHeaderPill(tab) {
    await tab.addStyleTag({ content: 'header .pill { visibility: hidden !important; }' });
}

/** The last redraws after the queries land: brush layers, the WebGL points, map tiles. */
async function settle(page) {
    // Places are matched after the positions land, under a progress bar of
    // their own; an import shows one too.
    await page.waitForFunction(() => !document.querySelector('[role="progressbar"]'), null, {
        timeout: 300_000,
    });
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(2000);
}

/** The health raster, switched to another signal. */
async function signal(page, name) {
    await page.getByRole('button', { name }).click();
    await page.waitForTimeout(300);
    await page.waitForFunction(() => !document.querySelector('.chart .empty'));
}

/**
 * Hand the script every map the page creates, so it can be framed.
 *
 * MapLibre keeps no reference to its maps, and the app has no reason to, so
 * the served bundle is rewritten on its way to the browser, for this run only:
 * `new X.Map({container…})` becomes the same call on a subclass that records
 * its instances. Nothing in the app changes.
 */
async function exposeMaps(context) {
    await context.addInitScript(() => {
        window.__shotMaps = [];
        window.__shotMap = (MapClass) =>
            class extends MapClass {
                constructor(...args) {
                    super(...args);
                    window.__shotMaps.push(this);
                }
            };
    });
    await context.route('**/_app/immutable/**/*.js', async (route) => {
        const response = await route.fetch();
        const body = await response.text();
        if (!body.includes('.Map({container:')) return route.fulfill({ response, body });
        await route.fulfill({
            response,
            body: body.replace(
                /new ([\w$]+)\.Map\(\{container:/g,
                'new (window.__shotMap($1.Map))({container:'
            ),
        });
    });
}

/**
 * Frame the positions map on the demo's city, its controls hidden: the page
 * prints the tiles' credit itself.
 */
async function frameDemoCity(page) {
    await page.addStyleTag({
        content: '.trail-toggle, .maplibregl-ctrl-attrib { visibility: hidden !important; }',
    });
    await page.waitForFunction(() => window.__shotMaps.length > 0, null, { timeout: 30_000 });
    await page.evaluate((view) => window.__shotMaps.at(-1).jumpTo(view), DEMO_CITY);
}

async function toWebp(png, maxWidth) {
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
        { data: png.toString('base64'), quality: QUALITY, maxWidth }
    );
    return Buffer.from(base64, 'base64');
}
