/**
 * The authoritative description of what a row model can structurally do (ARCHITECTURE.md §3 R4).
 *
 * Capabilities are checked instead of duck typing (`'applyTransaction' in rowModel` is forbidden).
 * If a feature is not truly implemented, its flag is `false`. We do not lie: a `true` flag is a
 * promise the corresponding command handler performs the operation rather than throwing.
 */
export interface RowModelCapabilities {
	// ── dataset shape ──
	/** The full logical dataset is held in memory. */
	readonly fullDataset: boolean;
	/** Only a loaded subset (blocks) is held; the rest is unloaded. */
	readonly loadedDataset: boolean;
	/** Only the current page/window is held. */
	readonly pagedDataset: boolean;

	// ── structural writes ──
	readonly replaceRows: boolean;
	readonly updateRows: boolean;
	readonly transactions: boolean;
	readonly rowOrder: boolean;

	// ── client-side pipeline ──
	readonly clientSort: boolean;
	readonly clientFilter: boolean;
	readonly clientGrouping: boolean;
	readonly clientTree: boolean;
	readonly aggregation: boolean;

	// ── loading models ──
	readonly blockLoading: boolean;
	readonly serverPagination: boolean;

	// ── cell mutation ──
	readonly cellMutation: boolean;
	readonly loadedRowMutation: boolean;
	readonly pageRowMutation: boolean;

	// ── selection scope ──
	readonly allRowSelection: boolean;
	readonly loadedRowSelection: boolean;
	readonly pageRowSelection: boolean;
}

type CapabilityKey = keyof RowModelCapabilities;

const ALL_FALSE: RowModelCapabilities = {
	fullDataset: false,
	loadedDataset: false,
	pagedDataset: false,
	replaceRows: false,
	updateRows: false,
	transactions: false,
	rowOrder: false,
	clientSort: false,
	clientFilter: false,
	clientGrouping: false,
	clientTree: false,
	aggregation: false,
	blockLoading: false,
	serverPagination: false,
	cellMutation: false,
	loadedRowMutation: false,
	pageRowMutation: false,
	allRowSelection: false,
	loadedRowSelection: false,
	pageRowSelection: false,
};

function withTrue(...keys: CapabilityKey[]): RowModelCapabilities {
	const out: RowModelCapabilities = { ...ALL_FALSE };
	for (const key of keys) {
		(out as Record<CapabilityKey, boolean>)[key] = true;
	}
	return out;
}

/** Client row model: owns the full dataset, fully mutable, client-side sort/filter/group/tree. */
export const clientRowModelCapabilities: RowModelCapabilities = withTrue(
	'fullDataset',
	'replaceRows',
	'updateRows',
	'transactions',
	'rowOrder',
	'clientSort',
	'clientFilter',
	'clientGrouping',
	'clientTree',
	'aggregation',
	'cellMutation',
	'allRowSelection',
);

/**
 * Infinite row model: owns loaded blocks only. No full dataset, no transactions, no row order, no
 * cell mutation by default (honest — not yet designed). Selection limited to loaded rows.
 */
export const infiniteRowModelCapabilities: RowModelCapabilities = withTrue(
	'loadedDataset',
	'blockLoading',
	'loadedRowSelection',
);

/**
 * Server row model: owns the current page only. No full dataset, no transactions, no row order, no
 * cell mutation by default. Selection limited to page rows.
 */
export const serverRowModelCapabilities: RowModelCapabilities = withTrue(
	'pagedDataset',
	'serverPagination',
	'pageRowSelection',
);
