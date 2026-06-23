/**
 * The three row-model kinds (ARCHITECTURE.md §3 R6, "Row Model Types"). Immutable for the life of
 * a grid instance — chosen at construction, never switched after mount.
 *
 * - `client`   owns the full dataset in memory.
 * - `infinite` owns loaded blocks only, backed by a datasource.
 * - `server`   owns the current page/window only, backed by a datasource.
 */
export type RowModelType = 'client' | 'infinite' | 'server';
