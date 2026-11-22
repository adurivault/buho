/**
 * The DuckDB layer: one in-memory database, one table per module.
 *
 * `client.ts` owns the connection and the generic helpers; each other file owns
 * one table — its schema, its natural key (the dedupe statement) and its insert.
 * Everything is re-exported here so callers import from `#lib/data/db/index.ts`.
 */
export * from './client';
export * from './format';
export * from './plays';
export * from './positions';
export * from './steps';
export * from './health';
export * from './messages';
export * from './activity';
