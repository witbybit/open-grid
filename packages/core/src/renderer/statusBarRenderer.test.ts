// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { StatusBarRenderer } from './statusBarRenderer.js';

function fakeEngine(opts: { totalRows: number; selected: string[] }) {
	const listeners: Array<() => void> = [];
	return {
		engine: {
			getRowModel: () => ({ getDataRowCount: () => opts.totalRows }),
			stateManager: { getState: () => ({ selectedRowIds: opts.selected }) },
			eventBus: {
				addEventListener: (_e: string, cb: () => void) => {
					listeners.push(cb);
					return () => {};
				},
			},
		} as any,
		fire: () => listeners.forEach((l) => l()),
	};
}

describe('StatusBarRenderer', () => {
	it('renders a grouped total row count', () => {
		const bar = document.createElement('div');
		const { engine } = fakeEngine({ totalRows: 12345, selected: [] });
		const r = new StatusBarRenderer(engine);
		r.mount(bar);
		expect(bar.textContent).toContain('Rows:');
		expect(bar.textContent).toContain((12345).toLocaleString());
		// No selection → no Selected panel.
		expect(bar.textContent).not.toContain('Selected');
		r.unmount();
	});

	it('shows the selected-row panel only when rows are selected', () => {
		const bar = document.createElement('div');
		const { engine } = fakeEngine({ totalRows: 10, selected: ['a', 'b', 'c'] });
		const r = new StatusBarRenderer(engine);
		r.mount(bar);
		expect(bar.textContent).toContain('Selected:');
		expect(bar.querySelector('.og-status-bar-panel-value')?.textContent).toBe('10');
		r.unmount();
	});
});
