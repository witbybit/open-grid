import type { GridEffect } from './GridEffect.js';

/**
 * The result of dispatching a command. Three outcomes, never collapsed into each other
 * (ARCHITECTURE.md §3 R2, §6, §7):
 *
 * - `applied`  — state changed; a commit was produced.
 * - `noop`     — the command was valid and supported, but changed nothing.
 * - `rejected` — the command was invalid, unsupported, or failed. NOT a no-op.
 *
 * This distinction is load-bearing for editing, AI proposals, validation, server writes, and
 * undo/redo: a UI must be able to tell "nothing to do" from "not allowed".
 */
export type GridCommandResult =
	| { readonly status: 'applied'; readonly commitId: string; readonly effects: readonly GridEffect[] }
	| { readonly status: 'noop'; readonly reason: string }
	| { readonly status: 'rejected'; readonly reason: string; readonly error?: Error };

export function appliedResult(commitId: string, effects: readonly GridEffect[]): GridCommandResult {
	return { status: 'applied', commitId, effects };
}

export function noopResult(reason: string): GridCommandResult {
	return { status: 'noop', reason };
}

export function rejectedResult(reason: string, error?: Error): GridCommandResult {
	return error ? { status: 'rejected', reason, error } : { status: 'rejected', reason };
}

export function isApplied(
	result: GridCommandResult,
): result is Extract<GridCommandResult, { status: 'applied' }> {
	return result.status === 'applied';
}
