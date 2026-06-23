import type { GridCommand } from './GridCommand.js';
import type { GridCommandResult } from './GridCommandResult.js';
import type { GridKernel } from './GridKernel.js';

export interface GridTransactionResult {
	readonly status: 'applied' | 'rejected';
	/** Per-command results, in dispatch order. */
	readonly results: readonly GridCommandResult[];
	/** Set when `status === 'rejected'`: the index of the command that stopped the batch. */
	readonly rejectedAtIndex?: number;
	readonly reason?: string;
}

/**
 * Dispatch a sequence of commands as one logical transaction (ARCHITECTURE.md §3 R1, transaction
 * boundary). Commands run in order under a shared transaction id; the batch stops at the first
 * rejection.
 *
 * NOTE: true atomic rollback of already-applied commands is NOT yet implemented — it requires
 * per-domain inverse application, which lands with the domain engines. Until then this is an
 * honest "stop on first failure" boundary, not a fake "all-or-nothing". Callers that need
 * atomicity must check `status` and decide. We do not pretend rollback works.
 */
export function dispatchTransaction(
	kernel: GridKernel,
	commands: readonly GridCommand[],
	transactionId: string,
): GridTransactionResult {
	const results: GridCommandResult[] = [];

	for (let index = 0; index < commands.length; index++) {
		const command = commands[index]!;
		const result = kernel.dispatch({ ...command, meta: { ...command.meta, transactionId } });
		results.push(result);

		if (result.status === 'rejected') {
			return { status: 'rejected', results, rejectedAtIndex: index, reason: result.reason };
		}
	}

	return { status: 'applied', results };
}
