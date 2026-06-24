// React adapter for the Plan 132 kernel-based core (ARCHITECTURE.md §3 R12–R13).
export { GridApiProvider, useGridApi, useGridSelector } from './GridContext.js';
export type { GridApiProviderProps } from './GridContext.js';
export { KernelGrid } from './KernelGrid.js';
export type { CellRenderer, CellRenderParams, KernelGridProps } from './KernelGrid.js';
