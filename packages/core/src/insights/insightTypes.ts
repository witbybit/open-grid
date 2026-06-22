export type GridInsightLayerId = 'dataQuality' | 'diff' | 'liveStream' | 'conflict';

export type GridInsightSeverity = 'info' | 'warning' | 'error';

export interface GridCellDecoration {
	readonly layerId: GridInsightLayerId;
	readonly kind: string;
	readonly severity?: GridInsightSeverity;
	readonly className?: string;
	readonly title?: string;
	readonly data?: unknown;
}

export interface GridRowDecoration {
	readonly layerId: GridInsightLayerId;
	readonly kind: string;
	readonly severity?: GridInsightSeverity;
	readonly className?: string;
	readonly title?: string;
	readonly data?: unknown;
}

/**
 * A read-only overlay that adds decorations, reports, and diagnostics on top of the grid engine.
 * Insight layers must never mutate row data, touch the DOM directly, schedule their own RAF,
 * or write to GridState. They only return metadata; the renderer consumes it.
 */
export interface GridInsightLayer {
	readonly id: GridInsightLayerId;

	getCellDecorations?(rowId: string, colField: string): readonly GridCellDecoration[];

	getRowDecorations?(rowId: string): readonly GridRowDecoration[];

	/** Returns a diagnostics snapshot for DevTools. Must return a plain serialisable object. */
	getDiagnostics?(): unknown;

	/** Called on unregister and on registry clear. Clean up any timers / subscriptions. */
	destroy?(): void;
}
