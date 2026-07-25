export interface AsyncRowModelRequestIdentity {
	readonly datasourceGeneration: number;
	readonly queryVersion: number;
	readonly requestId: number;
	readonly scopeId: string;
}

export function createInfiniteBlockScopeId(blockIndex: number): string {
	return `infinite:block:${blockIndex}`;
}
