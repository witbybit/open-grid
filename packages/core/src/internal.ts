// Adapter-facing internal entrypoint.
//
// Keep this surface narrow: framework adapters should depend on the host
// contract, not on raw store, engine, model, or renderer implementation classes.
export {
	hasImperativeRendererCapability,
	mountGridHost,
	resolveGridInteractionController,
	type GridAdapterHandle,
	type GridCellContentAdapter,
	type GridHeaderMenuAdapter,
	type GridHost,
	type GridHostOptions,
	type GridHostWithAdapter,
	type GridInteractionController,
	type GridRowContentAdapter,
} from './gridHost.js';
