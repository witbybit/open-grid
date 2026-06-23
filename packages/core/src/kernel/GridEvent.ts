/**
 * Events are published notifications derived from a commit. They are emitted by the kernel
 * ONLY (ARCHITECTURE.md §3 R1, §4). No domain engine, row model, or renderer emits events.
 */

/**
 * The canonical set of grid event names. Domains may extend the open string union, but the
 * named members are the contract the public API and tests rely on.
 */
export type GridEventType =
	// kernel lifecycle
	| 'grid.commandApplied'
	| 'grid.commandRejected'
	// domain events
	| 'rows.changed'
	| 'rows.replaced'
	| 'cells.changed'
	| 'columns.changed'
	| 'selection.changed'
	| 'editing.started'
	| 'editing.committed'
	| 'editing.cancelled'
	| 'pipeline.changed'
	| 'layout.changed'
	| 'viewport.changed'
	| 'render.invalidated'
	// allow forward-declared event names without losing autocomplete on the known ones
	| (string & {});

export interface GridEvent<TPayload = unknown> {
	readonly type: GridEventType;
	readonly payload: TPayload;
	/** The commit that produced this event. Lifecycle events for rejected commands omit it. */
	readonly commitId: string | null;
}

/**
 * What a command handler returns: an event without a commit id. The kernel stamps the commit
 * id during commit assembly (a handler cannot know its own commit id).
 */
export type GridEventDraft<TPayload = unknown> = Omit<GridEvent<TPayload>, 'commitId'>;

export type GridEventListener = (event: GridEvent) => void;
