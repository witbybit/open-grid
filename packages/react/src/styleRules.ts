import { useEffect } from 'react';
import type {
	GridApi,
	GridStyleRule,
	RowStyleRule,
	GroupRowStyleRule,
	DetailRowStyleRule,
	CellStyleRule,
	HeaderCellStyleRule,
} from '@open-grid/core';

export type StyleRule<TRowData = unknown> = GridStyleRule<TRowData>;
export type { RowStyleRule, GroupRowStyleRule, DetailRowStyleRule, CellStyleRule, HeaderCellStyleRule };

export { compileStyleRules } from '@open-grid/core';

export function useStyleRules<TRowData>(api: GridApi<TRowData>, rules: StyleRule<TRowData>[]): void {
	useEffect(() => {
		api.setStyleRules(rules.length > 0 ? rules : undefined);
	}, [api, rules]);
}
