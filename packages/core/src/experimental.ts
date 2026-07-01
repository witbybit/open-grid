// Experimental core entrypoint.
//
// Exports from this module are intentionally outside the reviewed alpha
// stability contract and may change or disappear between pre-release versions.
export { compileStyleRules } from './styling/styleRules.js';
export { NoopGridInstrumentation, RecordingGridInstrumentation, NOOP_INSTRUMENTATION } from './diagnostics/GridInstrumentation.js';
export {
	canEditCell,
	canFocusVisualRow,
	isDataVisualRow,
	isDataCellSelectable,
	isEditableVisualRow,
	isFullWidthVisualRow,
	isSelectableVisualRow,
} from './visualRow.js';
export {
	parseVisualRowId,
	toDataVisualRowId,
	toDetailVisualRowId,
	toFooterVisualRowId,
	toGroupVisualRowId,
	toLoadingVisualRowId,
} from './rows/visualRowIds.js';
export type { GroupPathItem } from './rows/visualRowIds.js';
