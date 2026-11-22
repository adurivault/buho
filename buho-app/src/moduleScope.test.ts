import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_MODULES } from '#lib/data/modules.ts';

const SRC = join(process.cwd(), 'src');
const ROLES = ['accent', 'soft', 'fill', 'peak'] as const;

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sources(path);
        return /\.(svelte|ts)$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
    });
}

describe('module colour scope', () => {
    it('declares every role for every module in app.css', () => {
        const css = readFileSync(join(SRC, 'app.css'), 'utf-8');
        for (const { id } of DATA_MODULES) {
            const block = css.match(new RegExp(`\\[data-module='${id}'\\] \\{([^}]*)\\}`))?.[1];
            expect(block, id).toBeDefined();
            for (const role of ROLES) expect(block, `${id} ${role}`).toContain(`--module-${role}:`);
        }
    });

    it("leaves components and pages to read a module's colours from its scope", () => {
        // A component that names one module's tokens paints that module on
        // every page it is reused on; `data-module` and `--module-*` follow the
        // page, the row or the chart it sits in.
        const ids = DATA_MODULES.map((m) => m.id).join('|');
        const literal = new RegExp(`--(accent|fill|peak)-(${ids})\\b`);
        const offenders: string[] = [];
        for (const file of [join(SRC, 'lib/components'), join(SRC, 'routes')].flatMap(sources)) {
            for (const [i, line] of readFileSync(file, 'utf-8').split('\n').entries()) {
                if (literal.test(line)) offenders.push(`${file.slice(SRC.length + 1)}:${i + 1}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
