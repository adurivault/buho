import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ImportEntry } from '#lib/data/sources/types.ts';
import type { ModuleId } from '#lib/data/modules.ts';
import { runImport, uploadEventProps, type ImportHooks } from './runImport';
import { ImportError } from './errors';

const drop = vi.hoisted(() => ({
    result: {
        threads: [] as unknown[],
        activity: [] as unknown[],
        positions: [] as unknown[],
        steps: [] as unknown[],
        health: [] as unknown[],
        plays: [] as unknown[],
        unrecognisedFiles: 0,
        failedParsers: [] as string[],
    },
}));

vi.mock('#lib/data/sources/registry.ts', () => ({
    readDrop: vi.fn(async () => drop.result),
}));

vi.mock('#lib/data/db/index.ts', () => ({
    initDuckDB: vi.fn(),
    isReady: vi.fn(() => true),
    dropTable: vi.fn(),
    insertPlays: vi.fn(),
    insertMessages: vi.fn(),
    insertGoogleActivity: vi.fn(),
    insertLocationSegments: vi.fn(),
    insertStepPackets: vi.fn(),
    insertHealthReadings: vi.fn(),
}));

import * as db from '#lib/data/db/index.ts';

const entry = (name: string): ImportEntry => ({
    path: name,
    name,
    peek: async () => '',
    text: async () => '',
    bytes: async () => new Uint8Array(),
});

function hooks(samples: ModuleId[] = []) {
    const calls = { replaced: [] as ModuleId[], positionsIncoming: 0, failed: [] as string[] };
    const h: ImportHooks = {
        progress: vi.fn(),
        stage: vi.fn(),
        parserFailed: (parser) => calls.failed.push(parser),
        isSample: (module) => samples.includes(module),
        sampleReplaced: (module) => calls.replaced.push(module),
        positionsIncoming: () => calls.positionsIncoming++,
    };
    return { h, calls };
}

const play = (source: string) => ({ source });
const segment = (source: string) => ({ source });

beforeEach(() => {
    vi.clearAllMocks();
    drop.result = {
        threads: [],
        activity: [],
        positions: [],
        steps: [],
        health: [],
        plays: [],
        unrecognisedFiles: 0,
        failedParsers: [],
    };
});

describe('runImport', () => {
    it('refuses an empty selection before reading anything', async () => {
        const { h } = hooks();
        await expect(runImport([], h)).rejects.toMatchObject({ code: 'empty-selection' });
    });

    it('calls a drop nobody claimed unrecognised, and one a parser choked on recognised', async () => {
        const { h } = hooks();
        await expect(runImport([entry('a.json')], h)).rejects.toMatchObject({
            code: 'unrecognised',
        });

        drop.result.failedParsers = ['spotify'];
        const { h: h2, calls } = hooks();
        const failure = await runImport([entry('a.json')], h2).catch((e) => e);
        expect(failure).toBeInstanceOf(ImportError);
        expect(failure.code).toBe('recognised-empty');
        expect(calls.failed).toEqual(['spotify']);
    });

    it('says it is waiting on the engine only when parsing finished first', async () => {
        const waiting = expect.objectContaining({ message: 'Starting the data engine...' });
        drop.result.plays = [play('spotify')];

        const { h: warm } = hooks();
        await runImport([entry('a')], warm);
        expect(warm.progress).not.toHaveBeenCalledWith(waiting);

        vi.mocked(db.isReady).mockReturnValueOnce(false);
        const { h: cold } = hooks();
        await runImport([entry('a')], cold);
        expect(cold.progress).toHaveBeenCalledWith(waiting);
        expect(db.initDuckDB).toHaveBeenCalledTimes(2);
    });

    it('reports every module it filled, with the services behind each', async () => {
        drop.result.plays = [play('spotify'), play('deezer'), play('spotify')];
        drop.result.positions = [segment('garmin')];
        drop.result.steps = [{}];

        const { h } = hooks();
        const { report, rowsByService } = await runImport([entry('a')], h);

        expect(report.modules).toEqual([
            { module: 'listening', rows: 3, services: ['deezer', 'spotify'] },
            { module: 'positions', rows: 1, services: ['garmin'] },
            { module: 'steps', rows: 1, services: ['garmin'] },
        ]);
        expect(rowsByService.get('spotify')).toBe(2);
        expect(rowsByService.get('garmin')).toBe(2);
    });

    it('drops a sample before real rows land in its table, and only that one', async () => {
        drop.result.plays = [play('spotify')];

        const { h, calls } = hooks(['listening', 'messages']);
        await runImport([entry('a')], h);

        expect(db.dropTable).toHaveBeenCalledWith('plays');
        expect(db.dropTable).not.toHaveBeenCalledWith('messages');
        expect(calls.replaced).toEqual(['listening']);
    });

    it('announces incoming positions and invalidates the daily table', async () => {
        drop.result.positions = [segment('google-timeline')];

        const { h, calls } = hooks();
        await runImport([entry('a')], h);

        expect(calls.positionsIncoming).toBe(1);
        expect(db.dropTable).toHaveBeenCalledWith('position_days');
    });
});

describe('uploadEventProps', () => {
    it('names the dominant service and whether the drop held what was expected', async () => {
        drop.result.plays = [play('spotify'), play('spotify'), play('deezer')];
        const { h } = hooks();
        const outcome = await runImport([entry('a'), entry('b')], h);

        const props = uploadEventProps(
            outcome,
            { pick: 'drop', surface: 'window', expected: 'deezer', adding: true },
            1200
        );
        expect(props.service).toBe('spotify');
        expect(props.services).toBe('deezer+spotify');
        expect(props.asExpected).toBe('true');
        expect(props.adding).toBe(true);
    });
});
