// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { PaginationBarRenderer } from './paginationBarRenderer.js';

function fakeEngine(opts: { totalRows: number; pageSize: number; page?: number }) {
	const state: any = { pagination: { pageSize: opts.pageSize, page: opts.page ?? 0 } };
	const dispatch = vi.fn();
	return {
		dispatch,
		getState: () => state,
		engine: {
			getRowModel: () => ({ getDataRowCount: () => opts.totalRows }),
			stateManager: {
				getState: () => state,
				setState: (patch: any) => Object.assign(state, patch),
				subscribeToKey: () => () => {},
			},
			eventBus: {
				addEventListener: () => () => {},
				dispatchEvent: dispatch,
			},
		} as any,
	};
}

describe('PaginationBarRenderer', () => {
	it('renders the page summary and page-of-pages info', () => {
		const bar = document.createElement('div');
		const { engine } = fakeEngine({ totalRows: 250, pageSize: 100 });
		const r = new PaginationBarRenderer(engine);
		r.mount(bar);
		expect(bar.querySelector('.og-pagination-summary')?.textContent).toBe('1–100 of 250');
		expect(bar.querySelector('.og-pagination-page-info')?.textContent).toBe('Page 1 of 3');
		r.unmount();
	});

	it('disables first/prev on page 0 and next/last on the last page', () => {
		const bar = document.createElement('div');
		const { engine } = fakeEngine({ totalRows: 250, pageSize: 100, page: 0 });
		const r = new PaginationBarRenderer(engine);
		r.mount(bar);
		const btns = [...bar.querySelectorAll('button')] as HTMLButtonElement[];
		expect(btns[0].disabled).toBe(true); // first
		expect(btns[1].disabled).toBe(true); // prev
		expect(btns[2].disabled).toBe(false); // next
		expect(btns[3].disabled).toBe(false); // last
		r.unmount();
	});

	it('navigates to the next page, updates state, and emits paginationChanged', () => {
		const bar = document.createElement('div');
		const { engine, getState, dispatch } = fakeEngine({ totalRows: 250, pageSize: 100, page: 0 });
		const r = new PaginationBarRenderer(engine);
		r.mount(bar);
		const next = [...bar.querySelectorAll('button')][2] as HTMLButtonElement;
		next.click();
		expect(getState().pagination.page).toBe(1);
		expect(dispatch).toHaveBeenCalledWith('paginationChanged', { page: 1, pageCount: 3, totalRows: 250, pageSize: 100 });
		expect(bar.querySelector('.og-pagination-summary')?.textContent).toBe('101–200 of 250');
		r.unmount();
	});

	it('clamps a stored page that is now out of range', () => {
		const bar = document.createElement('div');
		const { engine } = fakeEngine({ totalRows: 50, pageSize: 100, page: 5 });
		const r = new PaginationBarRenderer(engine);
		r.mount(bar);
		// 50 rows / 100 per page = 1 page; page 5 clamps to page 1 of 1.
		expect(bar.querySelector('.og-pagination-page-info')?.textContent).toBe('Page 1 of 1');
		expect(bar.querySelector('.og-pagination-summary')?.textContent).toBe('1–50 of 50');
		r.unmount();
	});
});
