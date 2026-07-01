export type GridConflictSource = 'liveStream' | 'serverRefresh' | 'collaboration' | 'import';

export interface GridCellConflict {
	readonly id: string;
	readonly rowId: string;
	readonly colField: string;
	readonly baseValue: unknown;
	readonly localValue: unknown;
	readonly remoteValue: unknown;
	readonly localVersion?: string | number;
	readonly remoteVersion?: string | number;
	readonly source: GridConflictSource;
	readonly createdAt: number;
	readonly message?: string;
}

export interface ResolveConflictOptions {
	readonly strategy: 'local' | 'remote' | 'custom';
	readonly value?: unknown;
}

export interface ConflictDiagnostics {
	readonly activeConflicts: number;
	readonly resolvedConflicts: number;
	readonly lastConflictAt: number | null;
}
