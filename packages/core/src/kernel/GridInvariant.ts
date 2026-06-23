/**
 * A violated structural assumption of the grid core. Thrown loudly — never swallowed into a
 * silent no-op (ARCHITECTURE.md §3 R4, "unsupported operations never silently no-op").
 */
export class GridInvariantError extends Error {
	constructor(message: string) {
		super(`Open Grid invariant violated: ${message}`);
		this.name = 'GridInvariantError';
	}
}

export function invariant(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new GridInvariantError(message);
	}
}
