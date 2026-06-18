/**
 * Plan 103 direct-write inventory.
 *
 * Entries here are the current production allowlist for raw StateManager/invalidation usage
 * while the remaining domains are converged onto GridChangeApplier. The list is intentionally
 * small and should shrink as follow-on work lands.
 */
export const GRID_DIRECT_WRITE_ALLOWLIST = [
	{
		file: 'engine/GridChangeApplier.ts',
		kind: 'canonical-commit',
		justification: 'Owns the authoritative logical commit path.',
	},
	{
		file: 'state/StateManager.ts',
		kind: 'state-kernel',
		justification: 'Owns low-level state storage and subscriber notification.',
	},
	{
		file: 'engine/GridEngine.ts',
		kind: 'bootstrap-derived',
		justification: 'Construction/bootstrap and the remaining centralized derived runtime writes remain here temporarily.',
	},
	{
		file: 'engine/CellNotificationController.ts',
		kind: 'derived-runtime',
		justification: 'Cell notifications emit renderer-local invalidations after data mutations.',
	},
	{
		file: 'engine/GridStateReactionController.ts',
		kind: 'legacy-derived',
		justification: 'Legacy reaction-owned invalidation remains only for derived synchronization and is being reduced in Plan 105.',
	},
	{
		file: 'features/GridStateFeatureController.ts',
		kind: 'legacy-ui-state',
		justification: 'Contains remaining UI-state setters not yet converted to typed commands.',
	},
	{
		file: 'renderer/RenderInvalidationCoordinator.ts',
		kind: 'render-authority',
		justification: 'Renderer authority bridges state/event observations into frame-coordinated paint work.',
	},
	{
		file: 'store.ts',
		kind: 'legacy-public-facade',
		justification: 'Public facade still carries a shrinking set of direct-write compatibility helpers pending Plan 109.',
	},
	{
		file: 'viewportController.ts',
		kind: 'viewport-runtime',
		justification: 'Viewport runtime updates derived visible ranges outside the logical mutation path.',
	},
] as const;
