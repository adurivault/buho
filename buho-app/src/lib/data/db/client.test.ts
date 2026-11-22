import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as db from './index';

// Mock Worker for jsdom
global.Worker = class {
    constructor() {}
    postMessage = vi.fn();
    terminate = vi.fn();
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
} as unknown as typeof Worker;

// We need to mock duckdb-wasm interactions since we can't easily run full WASM in pure jsdom test without setup
// However, the story says "DuckDB-WASM may not initialize in jsdom — mock Worker instantiation if needed"
// For the unit test of our service wrapper, we want to test the transformation logic and API surface.

vi.mock('@duckdb/duckdb-wasm', async () => {
    return {
        DuckDBDataProtocol: { HTTP: 1 },
        selectBundle: vi.fn().mockResolvedValue({
            mainModule: 'mock-wasm',
            mainWorker: 'mock-worker',
        }),
        ConsoleLogger: vi.fn(),
        AsyncDuckDB: vi.fn(function () {
            return {
                instantiate: vi.fn().mockResolvedValue(undefined),
                connect: vi.fn().mockResolvedValue({
                    query: vi.fn().mockResolvedValue({
                        toArray: () => [
                            {
                                snake_case_col: 1,
                                another_col: 'value',
                                toJSON: () => ({ snake_case_col: 1, another_col: 'value' }),
                            },
                        ],
                    }),
                    insert: vi.fn(),
                    close: vi.fn(),
                    prepare: vi.fn().mockResolvedValue({
                        query: vi.fn().mockResolvedValue({
                            toArray: () => [
                                {
                                    snake_case_col: 1,
                                    another_col: 'value',
                                    toJSON: () => ({ snake_case_col: 1, another_col: 'value' }),
                                },
                            ],
                        }),
                        close: vi.fn(),
                    }),
                }),
                open: vi.fn(),
                registerFileText: vi.fn(),
            };
        }),
    };
});

describe('Local time serialization (DST fix)', () => {
    const originalTz = process.env.TZ;

    afterEach(() => {
        process.env.TZ = originalTz;
    });

    it('formats winter and summer instants using the wall-clock hour for that historical date', () => {
        process.env.TZ = 'Europe/Paris';
        // Same UTC hour (12:00), but Paris is UTC+1 in January and UTC+2 in July.
        const winter = new Date(Date.UTC(2024, 0, 15, 12, 0, 0));
        const summer = new Date(Date.UTC(2024, 6, 15, 12, 0, 0));

        expect(db.formatLocalTimestamp(winter)).toBe('2024-01-15 13:00:00');
        expect(db.formatLocalTimestamp(summer)).toBe('2024-07-15 14:00:00');
    });

    it('does not shift the calendar day for local midnight in a positive UTC-offset zone', () => {
        process.env.TZ = 'Europe/Paris';
        // Local midnight on Jan 15 is Jan 14 23:00 UTC — toISOString().slice(0, 10)
        // would have produced "2024-01-14" here, one day off.
        const localMidnight = new Date(2024, 0, 15, 0, 0, 0);

        expect(db.formatLocalDate(localMidnight)).toBe('2024-01-15');
    });

    it('zero-pads single-digit month, day, hour, minute and second', () => {
        process.env.TZ = 'Europe/Paris';
        const d = new Date(2024, 0, 5, 3, 4, 5);

        expect(db.formatLocalTimestamp(d)).toBe('2024-01-05 03:04:05');
        expect(db.formatLocalDate(d)).toBe('2024-01-05');
    });
});

describe('DuckDB Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset internal state if possible, or we rely on module reloading if needed.
        // For now, we assume simple state testing.
    });

    it('should initialize successfully', async () => {
        await expect(db.initDuckDB()).resolves.not.toThrow();
        expect(db.isReady()).toBe(true);
    });

    it('should transform snake_case to camelCase in queries', async () => {
        // Ensure initialized
        if (!db.isReady()) await db.initDuckDB();

        const result = await db.query<{ snakeCaseCol: number; anotherCol: string }>(
            'SELECT * FROM test'
        );

        expect(result).toHaveLength(1);
        expect(result[0]).toHaveProperty('snakeCaseCol', 1);
        expect(result[0]).toHaveProperty('anotherCol', 'value');
        // Should not have snake_case keys
        expect(result[0]).not.toHaveProperty('snake_case_col');
    });

    it('should reject invalid table names in createTable', async () => {
        if (!db.isReady()) await db.initDuckDB();

        await expect(db.createTable('invalid-name', 'id INTEGER')).rejects.toThrow(
            'Invalid table name'
        );
        await expect(db.createTable('123starts_with_number', 'id INTEGER')).rejects.toThrow(
            'Invalid table name'
        );
        await expect(db.createTable('has spaces', 'id INTEGER')).rejects.toThrow(
            'Invalid table name'
        );
        await expect(db.createTable('DROP TABLE users;--', 'id INTEGER')).rejects.toThrow(
            'Invalid table name'
        );
    });

    it('should reject invalid table names in insertData', async () => {
        if (!db.isReady()) await db.initDuckDB();

        await expect(db.insertData('invalid-name', [{ id: 1 }])).rejects.toThrow(
            'Invalid table name'
        );
    });

    it('should reject invalid table names in dropTable', async () => {
        if (!db.isReady()) await db.initDuckDB();

        await expect(db.dropTable('invalid-name')).rejects.toThrow('Invalid table name');
    });

    it('should accept valid table names', async () => {
        if (!db.isReady()) await db.initDuckDB();

        // These should not throw (validation passes, actual query is mocked)
        await expect(db.createTable('valid_table', 'id INTEGER')).resolves.not.toThrow();
        await expect(db.createTable('ValidTable', 'id INTEGER')).resolves.not.toThrow();
        await expect(db.createTable('_private_table', 'id INTEGER')).resolves.not.toThrow();
    });
});

/**
 * The boot is started by whichever comes first — a warm-up on a drag, the
 * import, the sample — and the others arrive while it is still downloading.
 * Each test gets a module of its own, since the boot is module state.
 */
describe('Shared engine boot', () => {
    async function freshClient(instantiate: () => Promise<void> = async () => {}) {
        vi.resetModules();
        const duckdb = await import('@duckdb/duckdb-wasm');
        const AsyncDuckDB = vi.mocked(duckdb.AsyncDuckDB);
        AsyncDuckDB.mockClear();
        AsyncDuckDB.mockImplementation(function () {
            return {
                instantiate: vi.fn(instantiate),
                connect: vi.fn().mockResolvedValue({ query: vi.fn() }),
            } as never;
        });
        return { client: await import('./client'), AsyncDuckDB };
    }

    it('boots once, however many callers ask at the same time', async () => {
        const { client, AsyncDuckDB } = await freshClient();

        client.warmUpDuckDB();
        await Promise.all([client.initDuckDB(), client.initDuckDB()]);

        expect(AsyncDuckDB).toHaveBeenCalledTimes(1);
        expect(client.isReady()).toBe(true);
    });

    it('lets nobody through while the engine is still downloading', async () => {
        let finish: (() => void) | undefined;
        const { client } = await freshClient(
            () => new Promise<void>((resolve) => (finish = resolve))
        );

        client.warmUpDuckDB();
        let through = false;
        const needed = client.initDuckDB().then(() => (through = true));
        await vi.waitFor(() => expect(finish).toBeDefined());

        expect(through).toBe(false);
        expect(client.isReady()).toBe(false);

        finish!();
        await needed;
        expect(client.isReady()).toBe(true);
    });

    it('tries again after a failed boot', async () => {
        const instantiate = vi
            .fn<() => Promise<void>>()
            .mockRejectedValueOnce(new Error('no wasm'))
            .mockResolvedValue(undefined);
        const { client, AsyncDuckDB } = await freshClient(instantiate);

        await expect(client.initDuckDB()).rejects.toThrow('no wasm');
        await expect(client.initDuckDB()).resolves.toBeUndefined();

        expect(AsyncDuckDB).toHaveBeenCalledTimes(2);
        expect(client.isReady()).toBe(true);
    });

    it('keeps a failed warm-up quiet, for the caller that needs the engine to report', async () => {
        const { client } = await freshClient(() => Promise.reject(new Error('no wasm')));

        expect(() => client.warmUpDuckDB()).not.toThrow();
        await expect(client.initDuckDB()).rejects.toThrow('no wasm');
    });
});
