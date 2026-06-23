/**
 * The domains that own grid state. Each domain owns its own state, version, commands,
 * events, selectors, and serialization policy (ARCHITECTURE.md §3 R11).
 *
 * Only the kernel may bump a domain's version or emit an event on its behalf.
 */
export type GridDomainId =
	| 'rows'
	| 'columns'
	| 'cells'
	| 'pipeline'
	| 'selection'
	| 'editing'
	| 'layout'
	| 'viewport'
	| 'render'
	| 'validation'
	| 'clipboard';

export const GRID_DOMAIN_IDS: readonly GridDomainId[] = [
	'rows',
	'columns',
	'cells',
	'pipeline',
	'selection',
	'editing',
	'layout',
	'viewport',
	'render',
	'validation',
	'clipboard',
];
