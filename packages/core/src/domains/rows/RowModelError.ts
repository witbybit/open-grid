import type { RowModelType } from './RowModelType.js';

export class RowModelError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RowModelError';
	}
}

/**
 * Thrown when an operation is invoked on a row model that does not support it (ARCHITECTURE.md
 * §3 R4). This is the loud backstop behind the capability gate: the kernel executor checks the
 * capability and returns `rejected` before ever calling the handler, but if a handler is reached
 * for an unsupported operation it throws this rather than silently no-oping.
 */
export class UnsupportedRowModelOperationError extends RowModelError {
	readonly operation: string;
	readonly rowModelType: RowModelType;

	constructor(operation: string, rowModelType: RowModelType) {
		super(`Operation "${operation}" is not supported by the "${rowModelType}" row model.`);
		this.name = 'UnsupportedRowModelOperationError';
		this.operation = operation;
		this.rowModelType = rowModelType;
	}
}
