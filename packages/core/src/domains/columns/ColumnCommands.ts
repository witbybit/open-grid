import { handlerApplied, handlerNoop } from '../../kernel/GridCommit.js';
import type { GridKernel } from '../../kernel/GridKernel.js';
import type { ColumnChangeSet } from './ColumnChangeSet.js';
import { isEmptyColumnChange } from './ColumnChangeSet.js';
import type { ColumnPin } from './ColumnDef.js';
import type { ColumnId } from './ColumnId.js';
import type { ColumnModel } from './ColumnModel.js';
import type { ColumnState } from './ColumnState.js';

declare module '../../kernel/GridCommand.js' {
	interface GridCommandPayloads {
		'columns.resize': { readonly columnId: ColumnId; readonly width: number };
		'columns.move': { readonly columnId: ColumnId; readonly toIndex: number };
		'columns.setVisible': { readonly columnId: ColumnId; readonly visible: boolean };
		'columns.setPinned': { readonly columnId: ColumnId; readonly pinned: ColumnPin };
		'columns.setState': { readonly state: readonly ColumnState[] };
	}
}

/**
 * Register the column commands on the kernel (ARCHITECTURE.md §3 R1, R11). Each command applies a
 * column-model change and maps the result to a commit; a no-op change (resize to same width, etc.)
 * returns `noop`. Column geometry changes invalidate layout, so render invalidation is `full`.
 *
 * @returns an unregister-all function.
 */
export function registerColumnCommands<TRow>(kernel: GridKernel, model: ColumnModel<TRow>): () => void {
	const off: Array<() => void> = [];

	off.push(kernel.register('columns.resize', (c) => toDraft(model.resize(c.payload.columnId, c.payload.width))));
	off.push(kernel.register('columns.move', (c) => toDraft(model.move(c.payload.columnId, c.payload.toIndex))));
	off.push(kernel.register('columns.setVisible', (c) => toDraft(model.setVisible(c.payload.columnId, c.payload.visible))));
	off.push(kernel.register('columns.setPinned', (c) => toDraft(model.setPinned(c.payload.columnId, c.payload.pinned))));
	off.push(kernel.register('columns.setState', (c) => toDraft(model.setState(c.payload.state))));

	return () => {
		for (const fn of off) fn();
	};
}

function toDraft(changeSet: ColumnChangeSet) {
	if (isEmptyColumnChange(changeSet)) return handlerNoop('no column change');
	return handlerApplied({
		changes: [changeSet],
		dirtyDomains: ['columns'],
		events: [{ type: 'columns.changed', payload: summarize(changeSet) }],
		renderInvalidation: { scope: 'full', domains: ['columns'] },
	});
}

function summarize(changeSet: ColumnChangeSet) {
	return {
		resized: changeSet.resized.length,
		moved: changeSet.moved.length,
		visibilityChanged: changeSet.visibilityChanged.length,
		pinnedChanged: changeSet.pinnedChanged.length,
	};
}
