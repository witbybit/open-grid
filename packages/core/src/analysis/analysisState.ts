import type { FilterModel } from '../filterModel.js';
import type { GridQueryModel } from '../query/GridQueryModel.js';
import { countQueryNodes } from '../query/GridQueryModel.js';

export interface GridAnalysisStateSummary {
	readonly filterCount: number;
	readonly queryConditionCount: number;
	readonly queryGroupCount: number;
	readonly hasFilters: boolean;
	readonly hasQuery: boolean;
	readonly totalActiveItems: number;
}

export function summarizeAnalysisState(
	filterModel: FilterModel | null | undefined,
	queryModel: GridQueryModel | null | undefined
): GridAnalysisStateSummary {
	const filterCount = filterModel ? Object.keys(filterModel).length : 0;
	const queryCounts = queryModel ? countQueryNodes(queryModel.root) : { conditions: 0, groups: 0 };
	const queryConditionCount = queryCounts.conditions;
	const queryGroupCount = queryCounts.groups;
	const hasFilters = filterCount > 0;
	const hasQuery = queryConditionCount > 0;
	return {
		filterCount,
		queryConditionCount,
		queryGroupCount,
		hasFilters,
		hasQuery,
		totalActiveItems: filterCount + queryConditionCount,
	};
}
