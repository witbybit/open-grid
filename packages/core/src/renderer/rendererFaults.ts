import type { GridEngine } from '../engine/GridEngine.js';

export function reportRendererFault<TRowData>(
	engine: GridEngine<TRowData>,
	operation: string,
	error: unknown,
	context?: Record<string, unknown>
): void {
	engine.runtimeFaults.report({
		source: 'renderer',
		operation,
		error,
		context,
	});
}
