export type GridTraceValueCapture = 'none' | 'metadata' | 'full';

export interface GridTraceCellCoordinate {
	readonly rowId: string;
	readonly colField: string;
}

export interface GridTraceValueMetadata {
	readonly mode: 'metadata';
	readonly type: string;
	readonly isNull: boolean;
}

export type GridTraceCapturedValue = GridTraceValueMetadata | { readonly mode: 'full'; readonly value: unknown };

export type GridCausalEvent =
	| { readonly type: 'interaction'; readonly interactionId: string; readonly action: string; readonly cell?: GridTraceCellCoordinate }
	| { readonly type: 'commit-request'; readonly attemptId: number; readonly reason: string; readonly cell?: GridTraceCellCoordinate }
	| {
			readonly type: 'commit-outcome';
			readonly attemptId: number;
			readonly changeId?: number;
			readonly outcome: string;
			readonly domains: readonly string[];
	  }
	| { readonly type: 'invalidation'; readonly changeId?: number; readonly reason: string; readonly domains: readonly string[] }
	| {
			readonly type: 'cell-change';
			readonly changeId?: number;
			readonly cell: GridTraceCellCoordinate;
			readonly value?: GridTraceCapturedValue;
	  }
	| {
			readonly type: 'frame';
			readonly frameEpoch?: number;
			readonly changeIds: readonly number[];
			readonly correlation: 'render-request' | 'uncorrelated';
			readonly kind: string;
			readonly rowsVisited?: number;
			readonly cellsWritten?: number;
	  }
	| {
			readonly type: 'fallback';
			readonly component: string;
			readonly reason: string;
			readonly changeIds: readonly number[];
			readonly correlation: 'render-request' | 'uncorrelated';
	  }
	| { readonly type: 'fault'; readonly source: string; readonly operation: string; readonly message: string };

export interface GridCausalTraceEnvelope {
	readonly v: 1;
	readonly sessionId: string;
	readonly sequence: number;
	readonly timestamp: number;
	readonly event: GridCausalEvent;
}

export interface GridCausalTraceSnapshot {
	readonly v: 1;
	readonly sessionId: string | null;
	readonly active: boolean;
	readonly dropped: number;
	readonly events: readonly GridCausalTraceEnvelope[];
}

export type GridExplanationField<T> =
	| { readonly status: 'known'; readonly value: T }
	| { readonly status: 'unknown'; readonly reason: string }
	| { readonly status: 'not-applicable'; readonly reason: string };

export interface GridCellExplanation {
	readonly cell: GridTraceCellCoordinate;
	readonly lastChange: GridExplanationField<GridCausalTraceEnvelope>;
	readonly commit: GridExplanationField<GridCausalTraceEnvelope>;
	readonly invalidation: GridExplanationField<GridCausalTraceEnvelope>;
	readonly frame: GridExplanationField<GridCausalTraceEnvelope>;
}

export interface GridFlightRecorderOptions {
	readonly capacity?: number;
	readonly captureValues?: GridTraceValueCapture;
	readonly redactValue?: (value: unknown, cell: GridTraceCellCoordinate) => unknown;
}

/** Narrow observer port used by commit/render/runtime layers. */
export interface GridCausalTraceSink {
	isActive(): boolean;
	record(factory: () => GridCausalEvent): void;
	captureValue(value: unknown, cell: GridTraceCellCoordinate): GridTraceCapturedValue | undefined;
}
