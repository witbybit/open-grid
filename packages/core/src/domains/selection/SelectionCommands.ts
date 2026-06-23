import { handlerApplied, handlerNoop } from '../../kernel/GridCommit.js';
import type { GridKernel } from '../../kernel/GridKernel.js';
import type { RowId } from '../rows/RowId.js';
import type { SelectionChangeSet } from './SelectionChangeSet.js';
import { isEmptySelectionChange, SelectionModel } from './SelectionModel.js';

declare module '../../kernel/GridCommand.js' {
	interface GridCommandPayloads {
		'selection.selectRows': { readonly rowIds: readonly RowId[]; readonly mode?: 'replace' | 'add' };
		'selection.deselectRows': { readonly rowIds: readonly RowId[] };
		'selection.toggleRow': { readonly rowId: RowId };
		'selection.selectRange': { readonly orderedRowIds: readonly RowId[] };
		'selection.clear': Record<string, never>;
	}
}

/**
 * Register the selection commands on the kernel (ARCHITECTURE.md §3 R1). Each maps a selection-model
 * change to a commit; a change that selects/deselects nothing returns `noop`. Selection is a visual
 * highlight, so render invalidation is `cells`.
 *
 * @returns an unregister-all function.
 */
export function registerSelectionCommands(kernel: GridKernel, model: SelectionModel): () => void {
	const off: Array<() => void> = [];

	off.push(kernel.register('selection.selectRows', (c) => toDraft(model.selectRows(c.payload.rowIds, c.payload.mode))));
	off.push(kernel.register('selection.deselectRows', (c) => toDraft(model.deselectRows(c.payload.rowIds))));
	off.push(kernel.register('selection.toggleRow', (c) => toDraft(model.toggleRow(c.payload.rowId))));
	off.push(kernel.register('selection.selectRange', (c) => toDraft(model.selectRange(c.payload.orderedRowIds))));
	off.push(kernel.register('selection.clear', () => toDraft(model.clear())));

	return () => {
		for (const fn of off) fn();
	};
}

function toDraft(changeSet: SelectionChangeSet) {
	if (isEmptySelectionChange(changeSet)) return handlerNoop('no selection change');
	return handlerApplied({
		changes: [changeSet],
		dirtyDomains: ['selection'],
		events: [
			{
				type: 'selection.changed',
				payload: { added: changeSet.addedRows.length, removed: changeSet.removedRows.length, total: changeSet.next.selectedRowIds.size },
			},
		],
		renderInvalidation: { scope: 'cells', domains: ['selection'] },
	});
}
