import type { ColumnDef, GridCellPointer } from '../store.js';

export interface ScrollRenderContext<TRowData = unknown> {
	isScrolling: boolean;

	stateVersion: number;
	dataVersion: number;
	styleVersion: number;
	loadingVersion: number;

	activeEdit: GridCellPointer | null;
	customCellScrollMode: 'fallback' | 'defer' | 'mount' | 'preserve' | 'skeleton';

	hasStyleHooks: boolean;
	hasCustomRenderers: boolean;

	displayedColumns: ColumnDef<TRowData>[];
	visibleColRange: { startIdx: number; endIdx: number };

	focusedCell: GridCellPointer | null;

	canUseCachedDisplayValues: boolean;
}
