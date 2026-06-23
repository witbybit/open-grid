import type { GridCommand, GridCommandType } from './GridCommand.js';
import type { GridCommandResult } from './GridCommandResult.js';
import { appliedResult, noopResult, rejectedResult } from './GridCommandResult.js';
import type {
	GridCommandHandler,
	GridCommit,
	GridKernelContext,
} from './GridCommit.js';
import type { GridDomainId } from './GridDomain.js';
import type { GridEffect } from './GridEffect.js';
import type { GridEvent, GridEventDraft, GridEventListener } from './GridEvent.js';
import { invariant } from './GridInvariant.js';
import { GridUndoRedoEngine } from './GridUndoRedoEngine.js';
import type { GridVersionSnapshot } from './GridVersion.js';
import { GridVersionRegistry } from './GridVersion.js';

/**
 * The command-driven write gateway and the center of the system (ARCHITECTURE.md §1, §3 R1).
 *
 * The kernel owns, and is the ONLY owner of: command validation, the commit lifecycle, version
 * increments, event generation, dirty-domain calculation, render invalidation, undo/redo
 * recording, and rejection handling. Domains register typed handlers and return commit *drafts*;
 * the kernel turns drafts into commits and applies their effects centrally.
 *
 * Nothing else in the system bumps a version or emits an event.
 */
export class GridKernel {
	private readonly handlers = new Map<string, GridCommandHandler>();
	private readonly versions = new GridVersionRegistry();
	private readonly listeners = new Set<GridEventListener>();
	private readonly undoRedo = new GridUndoRedoEngine();
	private readonly idCounters = new Map<string, number>();
	private destroyed = false;

	private readonly context: GridKernelContext = {
		versionOf: (domain) => this.versions.get(domain),
		nextId: (prefix) => this.nextId(prefix),
	};

	// ── Registration ────────────────────────────────────────────────────────────

	/**
	 * Register the handler that owns a command type. One handler per type — registering twice is
	 * a programming error, not a silent override.
	 */
	register<K extends GridCommandType>(type: K, handler: GridCommandHandler<K>): () => void {
		invariant(!this.handlers.has(type), `command type "${type}" already has a handler`);
		this.handlers.set(type, handler as GridCommandHandler);
		return () => {
			if (this.handlers.get(type) === (handler as GridCommandHandler)) {
				this.handlers.delete(type);
			}
		};
	}

	// ── Dispatch ──────────────────────────────────────────────────────────────────

	/**
	 * The single entry point for changing grid state. Always returns one of applied / noop /
	 * rejected — these are never collapsed into each other. A command with no registered handler
	 * is rejected (never a silent no-op, ARCHITECTURE.md §3 R4).
	 */
	dispatch<K extends GridCommandType>(command: GridCommand<K>): GridCommandResult {
		invariant(!this.destroyed, 'dispatch called on a destroyed kernel');

		const handler = this.handlers.get(command.type);
		if (!handler) {
			return this.reject(command, `no handler for command "${command.type}"`);
		}

		let outcome;
		try {
			outcome = handler(command as GridCommand, this.context);
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			return this.reject(command, err.message, err);
		}

		if (outcome.status === 'rejected') {
			return this.reject(command, outcome.reason, outcome.error);
		}

		if (outcome.status === 'noop') {
			// A no-op produces no commit, no version bump, and no domain event.
			return noopResult(outcome.reason);
		}

		// applied → assemble and publish the commit.
		const commitId = this.nextId('commit');
		const dirtyDomains = dedupeDomains(outcome.dirtyDomains);

		const effects: GridEffect[] = [];
		for (const domain of dirtyDomains) {
			effects.push({ kind: 'version-bump', domain, version: this.versions.bump(domain) });
		}
		if (outcome.renderInvalidation && outcome.renderInvalidation.scope !== 'none') {
			effects.push({ kind: 'render-invalidation', invalidation: outcome.renderInvalidation });
		}
		if (outcome.effects) effects.push(...outcome.effects);

		const events: GridEvent[] = (outcome.events ?? []).map((draft) => stampEvent(draft, commitId));
		events.push({
			type: 'grid.commandApplied',
			commitId,
			payload: { commandType: command.type, dirtyDomains },
		});

		const commit: GridCommit = {
			id: commitId,
			command: command as GridCommand,
			changes: outcome.changes ?? [],
			effects,
			events,
			dirtyDomains,
			renderInvalidation: outcome.renderInvalidation ?? null,
			...(outcome.undoPatch ? { undoPatch: outcome.undoPatch } : {}),
		};

		// Record undo unless this commit *is* an undo/redo replay or was opted out.
		const source = command.meta?.source;
		const undoable = command.meta?.undoable !== false && source !== 'undo' && source !== 'redo';
		if (undoable) this.undoRedo.record(commit);

		this.publish(commit.events);
		return appliedResult(commitId, commit.effects);
	}

	private reject(command: GridCommand, reason: string, error?: Error): GridCommandResult {
		this.publish([
			{
				type: 'grid.commandRejected',
				commitId: null,
				payload: { commandType: command.type, reason },
			},
		]);
		return rejectedResult(reason, error);
	}

	// ── Undo / Redo (routed back through dispatch — same single gateway) ───────────

	canUndo(): boolean {
		return this.undoRedo.canUndo();
	}

	canRedo(): boolean {
		return this.undoRedo.canRedo();
	}

	undo(): GridCommandResult {
		const command = this.undoRedo.takeUndo();
		if (!command) return noopResult('nothing to undo');
		return this.dispatch({ ...command, meta: { ...command.meta, source: 'undo' } });
	}

	redo(): GridCommandResult {
		const command = this.undoRedo.takeRedo();
		if (!command) return noopResult('nothing to redo');
		return this.dispatch({ ...command, meta: { ...command.meta, source: 'redo' } });
	}

	// ── Subscription & version access ──────────────────────────────────────────────

	subscribe(listener: GridEventListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	getVersion(domain: GridDomainId): number {
		return this.versions.get(domain);
	}

	getVersionSnapshot(): GridVersionSnapshot {
		return this.versions.snapshot();
	}

	destroy(): void {
		this.destroyed = true;
		this.listeners.clear();
		this.handlers.clear();
		this.undoRedo.clear();
	}

	// ── Internals ───────────────────────────────────────────────────────────────────

	private publish(events: readonly GridEvent[]): void {
		for (const event of events) {
			for (const listener of this.listeners) {
				listener(event);
			}
		}
	}

	private nextId(prefix: string): string {
		const next = (this.idCounters.get(prefix) ?? 0) + 1;
		this.idCounters.set(prefix, next);
		return `${prefix}:${next}`;
	}
}

function dedupeDomains(domains: readonly GridDomainId[]): GridDomainId[] {
	return [...new Set(domains)];
}

function stampEvent(draft: GridEventDraft, commitId: string): GridEvent {
	return { type: draft.type, payload: draft.payload, commitId };
}
