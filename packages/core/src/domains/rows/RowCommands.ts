import type { GridCommitDraft } from '../../kernel/GridCommit.js';
import { handlerApplied, handlerNoop, handlerRejected } from '../../kernel/GridCommit.js';
import type { GridEventDraft, GridEventType } from '../../kernel/GridEvent.js';
import type { GridKernel } from '../../kernel/GridKernel.js';
import type { RenderInvalidation } from '../../kernel/GridEffect.js';
import type { RowChangeSet } from './RowChangeSet.js';
import { isFieldOnlyChange } from './RowChangeSet.js';
import type { RowCommandResult, RowTransaction } from './RowCommand.js';
import type { RowModelPlugin } from './RowModelPlugin.js';

declare module '../../kernel/GridCommand.js' {
	interface GridCommandPayloads {
		'rows.replace': { readonly rows: readonly unknown[] };
		'rows.update': { readonly updater: (rows: unknown[]) => unknown[] };
		'rows.applyTransaction': { readonly transaction: RowTransaction };
	}
}

/**
 * Register the row-write commands on the kernel for a given row model (ARCHITECTURE.md §3 R1, R3,
 * R4). Each command:
 *
 *  1. gates on the row model's `capabilities` — unsupported → `rejected` (never silent no-op);
 *  2. calls the structural handler, which returns a {@link RowCommandResult};
 *  3. maps the result into a kernel commit draft (changes, dirty domains, events, invalidation).
 *
 * The pipeline rebuild that `requiredPipelineRefresh` reports is performed by the pipeline domain;
 * here we mark `pipeline` dirty so the planner re-reads it.
 *
 * @returns an unregister-all function.
 */
export function registerRowCommands<TRow>(kernel: GridKernel, rowModel: RowModelPlugin<TRow>): () => void {
	const caps = rowModel.capabilities;
	const type = rowModel.type;
	const unregister: Array<() => void> = [];

	unregister.push(
		kernel.register('rows.replace', (command) => {
			if (!caps.replaceRows) return handlerRejected(`"replaceRows" unsupported by "${type}" row model`);
			const result = rowModel.commands.replaceRows(command.payload.rows as readonly TRow[]);
			return toDraft(result, 'rows.replaced');
		})
	);

	unregister.push(
		kernel.register('rows.update', (command) => {
			if (!caps.updateRows) return handlerRejected(`"updateRows" unsupported by "${type}" row model`);
			const result = rowModel.commands.updateRows(command.payload.updater as (rows: TRow[]) => TRow[]);
			return toDraft(result, 'rows.changed');
		})
	);

	unregister.push(
		kernel.register('rows.applyTransaction', (command) => {
			if (!caps.transactions) return handlerRejected(`"transactions" unsupported by "${type}" row model`);
			const result = rowModel.commands.applyTransaction(command.payload.transaction as RowTransaction<TRow>);
			return toDraft(result, 'rows.changed');
		})
	);

	return () => {
		for (const off of unregister) off();
	};
}

function toDraft(result: RowCommandResult, appliedEvent: 'rows.replaced' | 'rows.changed') {
	if (result.status === 'rejected') return handlerRejected(result.reason ?? 'rejected');

	const changes = result.rowChanges;
	if (result.status === 'noop' || isEmptyChange(changes)) {
		return handlerNoop(result.reason ?? 'no rows changed');
	}

	const fieldOnly = isFieldOnlyChange(changes);
	// The row model reports the refresh it requires. `none` defers to the shared impact classifier
	// in the pipeline domain, which can still upgrade a field-only edit to a sort/filter refresh;
	// until that lands, a `none` write leaves the pipeline untouched.
	const pipelineDirty = result.requiredPipelineRefresh !== 'none';

	const event: GridEventDraft = {
		type: appliedEvent satisfies GridEventType,
		payload: {
			added: changes.added.length,
			removed: changes.removed.length,
			updated: changes.updated.length,
		},
	};
	const renderInvalidation: RenderInvalidation = fieldOnly
		? { scope: 'cells', domains: ['rows'] }
		: { scope: 'rows', domains: ['rows', 'pipeline'] };

	const draft: GridCommitDraft = {
		changes: [changes],
		dirtyDomains: pipelineDirty ? ['rows', 'pipeline'] : ['rows'],
		events: [event],
		renderInvalidation,
	};
	return handlerApplied(draft);
}

function isEmptyChange(changes: RowChangeSet): boolean {
	return changes.added.length === 0 && changes.removed.length === 0 && changes.updated.length === 0 && changes.moved.length === 0;
}
