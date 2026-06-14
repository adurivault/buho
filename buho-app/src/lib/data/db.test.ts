import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as db from './db';
import * as duckdb from '@duckdb/duckdb-wasm';

// Mock Worker for jsdom
global.Worker = class {
    constructor() { }
    postMessage = vi.fn();
    terminate = vi.fn();
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
} as any;

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
                                toJSON: () => ({ snake_case_col: 1, another_col: 'value' })
                            }
                        ]
                    }),
                    insert: vi.fn(),
                    close: vi.fn(),
                    prepare: vi.fn().mockResolvedValue({
                        query: vi.fn().mockResolvedValue({
                            toArray: () => [
                                {
                                    snake_case_col: 1,
                                    another_col: 'value',
                                    toJSON: () => ({ snake_case_col: 1, another_col: 'value' })
                                }
                            ]
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

        const result = await db.query<{ snakeCaseCol: number; anotherCol: string }>('SELECT * FROM test');

        expect(result).toHaveLength(1);
        expect(result[0]).toHaveProperty('snakeCaseCol', 1);
        expect(result[0]).toHaveProperty('anotherCol', 'value');
        // Should not have snake_case keys
        expect(result[0]).not.toHaveProperty('snake_case_col');
    });

    it('should reject invalid table names in createTable', async () => {
        if (!db.isReady()) await db.initDuckDB();

        await expect(db.createTable('invalid-name', 'id INTEGER')).rejects.toThrow('Invalid table name');
        await expect(db.createTable('123starts_with_number', 'id INTEGER')).rejects.toThrow('Invalid table name');
        await expect(db.createTable('has spaces', 'id INTEGER')).rejects.toThrow('Invalid table name');
        await expect(db.createTable('DROP TABLE users;--', 'id INTEGER')).rejects.toThrow('Invalid table name');
    });

    it('should reject invalid table names in insertData', async () => {
        if (!db.isReady()) await db.initDuckDB();

        await expect(db.insertData('invalid-name', [{ id: 1 }])).rejects.toThrow('Invalid table name');
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
