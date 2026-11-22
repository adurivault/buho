import { build } from 'esbuild';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Hold the generated demo history against a real Spotify export.
 *
 *   node scripts/demo-stats.mjs                        # the demo alone
 *   node scripts/demo-stats.mjs ~/Downloads/my_spotify # side by side with yours
 *
 * The point is to make "the fake data feels too smooth" a number instead of a
 * feeling. Every row is a property some chart in Buho depends on; where the two
 * columns disagree is where the model is still lying.
 *
 * Nothing is written and nothing leaves the machine — the real export is read,
 * counted, and dropped.
 */

const SRC = new URL('../src/', import.meta.url).pathname;

/** The demo modules are TypeScript; bundle them in memory and import that. */
async function loadModules() {
    const result = await build({
        entryPoints: [join(SRC, 'lib/demo/index.ts')],
        bundle: true,
        format: 'esm',
        platform: 'node',
        write: false,
        // `#lib` imports in these files are types only, which erase at build.
        external: ['#lib/*'],
        // Stripping types needs no compiler option, and esbuild cannot follow
        // the project tsconfig's `extends` into SvelteKit's `$app/tsconfig`.
        tsconfigRaw: {},
    });
    const code = result.outputFiles[0].text;
    return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

async function readExport(path) {
    const target = resolve(path.replace(/^~/, process.env.HOME ?? '~'));
    const info = await stat(target);

    const files = [];
    if (info.isDirectory()) {
        const walk = async (dir) => {
            for (const entry of await readdir(dir, { withFileTypes: true })) {
                const full = join(dir, entry.name);
                if (entry.isDirectory()) await walk(full);
                else if (entry.name.endsWith('.json')) files.push(full);
            }
        };
        await walk(target);
    } else {
        files.push(target);
    }

    const entries = [];
    for (const file of files) {
        let parsed;
        try {
            parsed = JSON.parse(await readFile(file, 'utf8'));
        } catch {
            continue;
        }
        if (!Array.isArray(parsed)) continue;
        // The same test the importer uses to claim a file.
        if (!parsed.length || typeof parsed[0]?.ts !== 'string' || !('ms_played' in parsed[0])) {
            continue;
        }
        entries.push(...parsed);
    }
    return entries;
}

function sideBySide(left, right, leftTitle, rightTitle) {
    const leftLines = left.split('\n');
    const rightLines = right.split('\n');
    const width = Math.max(...leftLines.map((line) => line.length), leftTitle.length) + 4;
    const rows = [
        `${leftTitle.padEnd(width)}${rightTitle}`,
        `${'─'.repeat(width - 4).padEnd(width)}${'─'.repeat(rightTitle.length)}`,
    ];
    for (let index = 0; index < Math.max(leftLines.length, rightLines.length); index += 1) {
        rows.push(`${(leftLines[index] ?? '').padEnd(width)}${rightLines[index] ?? ''}`);
    }
    return rows.join('\n');
}

const { generateListening, measureListening, formatStats } = await loadModules();

const demo = measureListening(generateListening());
const demoReport = formatStats(demo);

const path = process.argv[2];
if (!path) {
    console.log(`\n${demoReport}\n`);
    console.log('Pass a real export to compare: node scripts/demo-stats.mjs <folder>\n');
} else {
    const real = await readExport(path);
    if (real.length === 0) {
        console.error(`No Spotify streaming history found in ${path}`);
        process.exit(1);
    }
    console.log(
        `\n${sideBySide(demoReport, formatStats(measureListening(real)), 'GENERATED', 'YOURS')}\n`
    );
}
