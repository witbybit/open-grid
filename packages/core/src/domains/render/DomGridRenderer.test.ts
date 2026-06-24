// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { GridCore } from '../../api/GridCore.js';
import { DomGridRenderer } from './DomGridRenderer.js';

// jsdom does not implement ResizeObserver — stub it so DomGridRenderer.mount() can proceed.
globalThis.ResizeObserver = class {
	constructor(private readonly cb: ResizeObserverCallback) {}
	observe(target: Element) {
		// Fire a synthetic initial size so setSize() gets called inside mount().
		this.cb([{ contentRect: { width: 800, height: 400 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
	}
	unobserve() {}
	disconnect() {}
};

interface Row {
	id: string;
	name: string;
	score: number;
}

const COLUMNS = [
	{ id: 'name', field: 'name', header: 'Name', width: 120 },
	{ id: 'score', field: 'score', header: 'Score', width: 80 },
];

const ROWS: Row[] = [
	{ id: 'r1', name: 'Alice', score: 42 },
	{ id: 'r2', name: 'Bob', score: 17 },
	{ id: 'r3', name: 'Cyd', score: 99 },
];

function setup() {
	const core = new GridCore<Row>({ columns: COLUMNS, getRowId: (r) => r.id, rowHeight: 40 });
	core.kernel.dispatch({ type: 'rows.replace', payload: { rows: ROWS } });
	core.viewport.setSize(800, 400);

	const container = document.createElement('div');
	document.body.appendChild(container);

	const view = core.getRendererView();
	const renderer = new DomGridRenderer<Row>(view);
	return { core, renderer, container, view };
}

describe('DomGridRenderer — DOM structure (ARCHITECTURE.md §3 R12–R13)', () => {
	const mounted: Array<{ renderer: DomGridRenderer<Row>; container: HTMLElement }> = [];

	beforeEach(() => {
		while (mounted.length) {
			const m = mounted.pop()!;
			m.renderer.unmount();
			m.container.remove();
		}
	});

	function mountGrid() {
		const s = setup();
		s.renderer.mount(s.container);
		mounted.push(s);
		return s;
	}

	it('mount() appends og-scroll-viewport inside the container', () => {
		const { container } = mountGrid();
		expect(container.querySelector('.og-scroll-viewport')).not.toBeNull();
	});

	it('mount() creates a header wrapper with left/center/right lane divs', () => {
		const { container } = mountGrid();
		expect(container.querySelector('.og-layer-header-wrapper')).not.toBeNull();
		expect(container.querySelector('.og-layer-header')).not.toBeNull();
		expect(container.querySelector('.og-layer-header-left')).not.toBeNull();
		expect(container.querySelector('.og-layer-header-right')).not.toBeNull();
	});

	it('header cells appear in the center lane for unpinned columns', () => {
		const { container } = mountGrid();
		const headerCells = container.querySelectorAll('.og-layer-header .og-header-cell');
		expect(headerCells.length).toBe(2);
		expect(headerCells[0]!.textContent).toBe('Name');
		expect(headerCells[1]!.textContent).toBe('Score');
	});

	it('pinned-right column header goes into the right lane', () => {
		const core = new GridCore<Row>({
			columns: [
				{ id: 'name', field: 'name', header: 'Name', width: 120 },
				{ id: 'score', field: 'score', header: 'Score', width: 80, pinned: 'right' },
			],
			getRowId: (r) => r.id,
			rowHeight: 40,
		});
		core.kernel.dispatch({ type: 'rows.replace', payload: { rows: ROWS } });
		core.viewport.setSize(800, 400);
		const container = document.createElement('div');
		document.body.appendChild(container);
		const renderer = new DomGridRenderer<Row>(core.getRendererView());
		renderer.mount(container);
		mounted.push({ renderer, container });

		const rightCells = container.querySelectorAll('.og-layer-header-right .og-header-cell');
		expect(rightCells.length).toBe(1);
		expect(rightCells[0]!.textContent).toBe('Score');
		const centerCells = container.querySelectorAll('.og-layer-header .og-header-cell');
		expect(centerCells.length).toBe(1);
		expect(centerCells[0]!.textContent).toBe('Name');
	});

	it('row slots are created for visible rows', () => {
		const { container } = mountGrid();
		const rows = container.querySelectorAll('.og-rows-container .og-row');
		expect(rows.length).toBeGreaterThan(0);
	});

	it('row slots have translateY transform set', () => {
		const { container } = mountGrid();
		const firstRow = container.querySelector<HTMLDivElement>('.og-rows-container .og-row');
		expect(firstRow?.style.transform).toMatch(/translateY/);
	});

	it('data cells carry og-cell class and display the cell value', () => {
		const { container } = mountGrid();
		const cells = container.querySelectorAll('.og-row .og-cell');
		const texts = Array.from(cells).map((c) => c.textContent?.trim()).filter(Boolean);
		expect(texts).toContain('Alice');
		expect(texts).toContain('42');
	});

	it('og-rows-container height reflects total rows height', () => {
		const { container } = mountGrid();
		const rc = container.querySelector<HTMLDivElement>('.og-rows-container');
		// 3 rows × 40px = 120px
		expect(rc?.style.height).toBe('120px');
	});

	it('unmount() clears the container DOM', () => {
		const { renderer, container } = setup();
		renderer.mount(container);
		renderer.unmount();
		mounted.length = 0; // already unmounted
		expect(container.innerHTML).toBe('');
	});

	it('view.setScroll/setSize round-trip works (no crash)', () => {
		const { view } = mountGrid();
		// These should not throw; they update the viewport model.
		expect(() => {
			view.setScroll(40, 0);
			view.setSize(600, 300);
		}).not.toThrow();
	});
});
