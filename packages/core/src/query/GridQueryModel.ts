// Cross-column nested AND/OR query model.
// Distinct from FilterModel (per-column) — this layer combines conditions
// across columns in arbitrary nested groups.

export type GridQueryNode = GridQueryGroup | GridQueryCondition;

export interface GridQueryGroup {
	readonly kind: 'group';
	readonly id: string;
	readonly operator: 'and' | 'or';
	readonly children: readonly GridQueryNode[];
}

export interface GridQueryCondition {
	readonly kind: 'condition';
	readonly id: string;
	/** Matches a column's `field` value. */
	readonly columnId: string;
	/** Operator string — see queryOperatorRegistry for valid values per column type. */
	readonly operator: string;
	/** Primary value for the condition. Not used for blank/notBlank operators. */
	readonly value?: unknown;
	/** Upper bound for range operators (inRange / between). */
	readonly valueTo?: unknown;
}

export interface GridQueryModel {
	readonly version: number;
	readonly root: GridQueryGroup;
}

/** Diagnostic produced when a condition references an unknown column or operator. */
export interface QueryConditionDiagnostic {
	readonly conditionId: string;
	readonly columnId: string;
	readonly reason: 'unknown-column' | 'unknown-operator' | 'invalid-value';
	readonly message: string;
}

export interface QueryDiagnostics {
	readonly active: boolean;
	readonly conditionCount: number;
	readonly groupCount: number;
	readonly invalidConditions: readonly string[];
}

/** Count leaf conditions in a query model. */
export function countQueryNodes(root: GridQueryGroup): { conditions: number; groups: number } {
	let conditions = 0;
	let groups = 0;
	function visit(node: GridQueryNode): void {
		if (node.kind === 'condition') {
			conditions++;
		} else {
			groups++;
			for (const child of node.children) visit(child);
		}
	}
	visit(root);
	return { conditions, groups };
}

/** Return true when the query model has at least one condition. */
export function isQueryModelActive(model: GridQueryModel | null | undefined): boolean {
	if (!model) return false;
	return countQueryNodes(model.root).conditions > 0;
}

/** Create a new empty root group. */
export function createEmptyQueryModel(): GridQueryModel {
	return {
		version: 1,
		root: { kind: 'group', id: 'root', operator: 'and', children: [] },
	};
}
