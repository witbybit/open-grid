import type { GridChangeSet } from './GridChangeSet.js';
import type { GridCommand, GridCommandType } from './GridCommand.js';
import type { GridDomainId } from './GridDomain.js';
import type { GridEffect, RenderInvalidation } from './GridEffect.js';
import type { GridEvent, GridEventDraft } from './GridEvent.js';

/**
 * A patch describing how to reverse (and re-apply) an applied command (ARCHITECTURE.md §3 R1,
 * undo/redo foundation). The kernel records this on the undo stack; undo dispatches `undo`,
 * redo dispatches `redo`.
 */
export interface GridUndoPatch {
	readonly undo: GridCommand;
	readonly redo: GridCommand;
	readonly label: string;
}

/**
 * The kernel's complete record of one applied command (ARCHITECTURE.md §6). Immutable.
 */
export interface GridCommit<K extends GridCommandType = GridCommandType> {
	readonly id: string;
	readonly command: GridCommand<K>;
	readonly changes: readonly GridChangeSet[];
	readonly effects: readonly GridEffect[];
	readonly events: readonly GridEvent[];
	readonly dirtyDomains: readonly GridDomainId[];
	readonly renderInvalidation: RenderInvalidation | null;
	readonly undoPatch?: GridUndoPatch;
}

/**
 * What a command handler returns when it successfully changes state. The kernel converts this
 * draft into a {@link GridCommit}: it assigns the commit id, bumps the versions of every dirty
 * domain (emitting `version-bump` effects), stamps the commit id onto event drafts, and records
 * the undo patch. Handlers describe; the kernel applies (ARCHITECTURE.md §3 R2).
 */
export interface GridCommitDraft {
	readonly changes?: readonly GridChangeSet[];
	/** Effects beyond the automatic per-dirty-domain version bumps (e.g. extra invalidations). */
	readonly effects?: readonly GridEffect[];
	/** Domain events, without commit ids — the kernel stamps them. */
	readonly events?: readonly GridEventDraft[];
	/** Domains whose version must bump. */
	readonly dirtyDomains: readonly GridDomainId[];
	readonly renderInvalidation?: RenderInvalidation | null;
	readonly undoPatch?: GridUndoPatch;
}

/**
 * The three outcomes a handler may return. Mirrors {@link GridCommandResult} but carries the
 * commit draft on success (the kernel owns commit-id assignment and publication).
 */
export type GridCommandHandlerResult =
	| ({ readonly status: 'applied' } & GridCommitDraft)
	| { readonly status: 'noop'; readonly reason: string }
	| { readonly status: 'rejected'; readonly reason: string; readonly error?: Error };

/**
 * Read-only context handed to a command handler. A handler may read versions and mint ids; it
 * may NOT bump versions, emit events, or invalidate rendering — those are effects the kernel
 * applies from the returned draft (ARCHITECTURE.md §3 R1, §4).
 */
export interface GridKernelContext {
	/** Current version of a domain (before this commit). */
	versionOf(domain: GridDomainId): number;
	/** Mint a unique id with a prefix, e.g. `nextId('edit') -> 'edit:7'`. */
	nextId(prefix: string): string;
}

export type GridCommandHandler<K extends GridCommandType = GridCommandType> = (
	command: GridCommand<K>,
	ctx: GridKernelContext,
) => GridCommandHandlerResult;

/** Convenience constructors for handler authors. */
export function handlerApplied(draft: GridCommitDraft): GridCommandHandlerResult {
	return { status: 'applied', ...draft };
}

export function handlerNoop(reason: string): GridCommandHandlerResult {
	return { status: 'noop', reason };
}

export function handlerRejected(reason: string, error?: Error): GridCommandHandlerResult {
	return error ? { status: 'rejected', reason, error } : { status: 'rejected', reason };
}
