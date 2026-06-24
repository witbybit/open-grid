import { describe, expect, it } from 'vitest';
import { GridCore } from '../../api/GridCore.js';
import { computeRenderLayout } from './RenderLayout.js';

interface Person {
	id: string;
	name: string;
	age: number;
}

const columns = [
	{ id: 'name', field: 'name', width: 120, header: 'Name' },
	{ id: 'age', field: 'age', width: 80, header: 'Age', pinned: 'right' as const },
];

const seed: Person[] = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, name: `N${i}`, age: i }));

function view(opts: Partial<Parameters<typeof GridCore<Person>>[0]> = {}) {
	const core = new GridCore<Person>({ columns, getRowId: (r) => r.id, rowHeight: 40, ...opts });
	core.kernel.dispatch({ type: 'rows.replace', payload: { rows: seed } });
	core.viewport.setScroll(0, 0);
	core.viewport.setSize(400, 200);
	return core.getRendererView();
}

describe('computeRenderLayout — view-based layout (ARCHITECTURE.md §3 R12)', () => {
	it('computes dimensions + column lanes from the view geometry', () => {
		const layout = computeRenderLayout(view());
		expect(layout.dimensions.totalRowsHeight).toBe(2000); // 50 * 40
		expect(layout.dimensions.totalColumnsWidth).toBe(200); // 120 + 80
		expect(layout.dimensions.contentWidth).toBe(400); // max(200, viewport 400)
		// 'age' is pinned right (80), 'name' is center (120)
		expect(layout.columns.centerWidth).toBe(120);
		expect(layout.columns.rightWidth).toBe(80);
		expect(layout.columns.leftWidth).toBe(0);
	});

	it('chrome heights reflect display config; row layer sits below the top chrome', () => {
		const layout = computeRenderLayout(view({ showStatusBar: true, showFloatingFilters: true }));
		expect(layout.chrome.headerHeight).toBe(40);
		expect(layout.chrome.floatingFilterHeight).toBe(36);
		expect(layout.chrome.statusBarHeight).toBe(32);
		expect(layout.chrome.topChromeHeight).toBe(40 + 36); // header + floating (no group panel / chip bar)
		expect(layout.origins.rowLayerTop).toBe(76);
		expect(layout.origins.bottomChromeTop).toBe(200 - 32);
	});

	it('row window comes from the viewport visible window', () => {
		const layout = computeRenderLayout(view());
		expect(layout.rows.firstIndex).toBe(0);
		expect(layout.rows.lastIndex).toBe(5); // 200px / 40px
	});
});
