import type { GridDomainId } from './GridDomain.js';

/**
 * The base shape every domain change set extends (RowChangeSet, ColumnChangeSet, CellChangeSet,
 * SelectionChangeSet…). A change set is a typed description of *what a domain changed* — it
 * carries no instructions about refresh, events, or rendering. Those are effects, owned by the
 * kernel (ARCHITECTURE.md §3 R2, §5).
 */
export interface GridChangeSet {
	readonly domain: GridDomainId;
}
