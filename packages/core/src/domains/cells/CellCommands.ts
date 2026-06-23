import { handlerApplied, handlerNoop, handlerRejected } from '../../kernel/GridCommit.js';
import type { GridCommitDraft } from '../../kernel/GridCommit.js';
import type { GridKernel } from '../../kernel/GridKernel.js';
import type { ColumnId } from '../columns/ColumnId.js';
import type { RowModelCapabilities } from '../rows/RowModelCapabilities.js';
import type { RowModelType } from '../rows/RowModelType.js';
import type { CellAddress } from './CellAddress.js';
import type { CellValueEngine, CellWriteOutcome } from './CellValueEngine.js';
import type { ValueSetter } from './ValueSetter.js';

declare module '../../kernel/GridCommand.js' {
	interface GridCommandPayloads {
		'cell.setValue': { readonly address: CellAddress; readonly value: unknown };
	}
}

export interface CellCommandHost {
	readonly type: RowModelType;
	readonly capabilities: RowModelCapabilities;
}

export interface CellCommandOptions<TRow> {
	/** Resolve a column's value setter, if any. Columns supply these once the columns domain lands. */
	resolveValueSetter?: (columnId: ColumnId) => ValueSetter<TRow> | undefined;
}

/**
 * Register `cell.setValue` on the kernel (ARCHITECTURE.md §3 R1, R8, R9). Capability-gated on
 * `cellMutation` — a write to an infinite/server model is `rejected`, never silent. An applied edit
 * carries a working undo patch (undo re-sets the old value through the same gateway).
 *
 * @returns an unregister function.
 */
export function registerCellCommands<TRow>(
	kernel: GridKernel,
	host: CellCommandHost,
	engine: CellValueEngine<TRow>,
	options: CellCommandOptions<TRow> = {},
): () => void {
	return kernel.register('cell.setValue', (command) => {
		if (!host.capabilities.cellMutation) {
			return handlerRejected(`"cellMutation" unsupported by "${host.type}" row model`);
		}

		const { address, value } = command.payload;
		const valueSetter = options.resolveValueSetter?.(address.columnId);
		const outcome = engine.applyCellValue(address, value, valueSetter ? { valueSetter } : {});
		return toDraft(outcome, address);
	});
}

function toDraft(outcome: CellWriteOutcome, address: CellAddress) {
	switch (outcome.status) {
		case 'rejected':
			return handlerRejected(outcome.reason);
		// An abort or a declined setter is a deliberate non-write, not a failure: report as noop.
		case 'aborted':
		case 'noop':
			return handlerNoop(outcome.reason);
		case 'applied': {
			const draft: GridCommitDraft = {
				changes: [outcome.changeSet],
				// rows bumps because the row data changed; cells bumps for value subscribers. Whether a
				// value edit also dirties the pipeline (sort/filter key) is the shared classifier's call
				// once it lands; until then a value edit leaves the pipeline untouched.
				dirtyDomains: ['rows', 'cells'],
				events: [
					{
						type: 'cells.changed',
						payload: { rowId: address.rowId, columnId: address.columnId, field: address.field },
					},
				],
				renderInvalidation: { scope: 'cells', domains: ['rows', 'cells'] },
				undoPatch: {
					label: 'edit cell',
					undo: { type: 'cell.setValue', payload: { address, value: outcome.oldValue } },
					redo: { type: 'cell.setValue', payload: { address, value: outcome.newValue } },
				},
			};
			return handlerApplied(draft);
		}
	}
}
