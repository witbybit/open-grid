import { UnsupportedRowModelOperationError } from './RowModelError.js';
import type { RowModelCommandHandlers } from './RowModelPlugin.js';
import type { RowModelType } from './RowModelType.js';

/**
 * Build a full set of command handlers that throw {@link UnsupportedRowModelOperationError}
 * (ARCHITECTURE.md §3 R3–R4). Shells (infinite/server) start from these and override only what
 * they truly support. The kernel executor gates on capabilities and returns `rejected` before a
 * handler is reached; these throws are the loud backstop if that gate is ever bypassed.
 */
export function unsupportedCommandHandlers<TRow>(type: RowModelType): RowModelCommandHandlers<TRow> {
	const fail = (operation: string): never => {
		throw new UnsupportedRowModelOperationError(operation, type);
	};
	return {
		replaceRows: () => fail('replaceRows'),
		updateRows: () => fail('updateRows'),
		applyTransaction: () => fail('applyTransaction'),
		writeCellValue: () => fail('writeCellValue'),
	};
}
