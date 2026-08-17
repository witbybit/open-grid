import type { GridApi } from './api/GridApi.js';
import type { GridCausalTraceSnapshot, GridCellExplanation, GridFlightRecorderOptions } from './diagnostics/GridCausalTrace.js';
import { GridFlightRecorderInstrumentation } from './diagnostics/GridFlightRecorder.js';
import type { GridInstrumentation } from './diagnostics/GridInstrumentation.js';
import { resolveGridRuntimeComposition } from './internal/apiInternalBridge.js';

const priorInstrumentation = new WeakMap<GridApi<unknown>, GridInstrumentation>();

export function startFlightRecorder<TRowData>(api: GridApi<TRowData>, options?: GridFlightRecorderOptions): void {
	const engine = resolveGridRuntimeComposition(api).host.engine;
	const key = api as GridApi<unknown>;
	if (!priorInstrumentation.has(key)) priorInstrumentation.set(key, engine.instrumentation);
	engine.flightRecorder.start(options);
	engine.setInstrumentation(new GridFlightRecorderInstrumentation(priorInstrumentation.get(key)!, engine.flightRecorder));
}

export function stopFlightRecorder<TRowData>(api: GridApi<TRowData>): GridCausalTraceSnapshot {
	const engine = resolveGridRuntimeComposition(api).host.engine;
	engine.flightRecorder.stop();
	const prior = priorInstrumentation.get(api as GridApi<unknown>);
	if (prior) engine.setInstrumentation(prior);
	priorInstrumentation.delete(api as GridApi<unknown>);
	return engine.flightRecorder.snapshot();
}

export function getFlightRecorderSnapshot<TRowData>(api: GridApi<TRowData>): GridCausalTraceSnapshot {
	return resolveGridRuntimeComposition(api).host.engine.flightRecorder.snapshot();
}

export function explainFlightRecorderCell<TRowData>(api: GridApi<TRowData>, rowId: string, colField: string): GridCellExplanation {
	return resolveGridRuntimeComposition(api).host.engine.flightRecorder.explainCell(rowId, colField);
}

export function clearFlightRecorder<TRowData>(api: GridApi<TRowData>): void {
	resolveGridRuntimeComposition(api).host.engine.flightRecorder.clear();
}
