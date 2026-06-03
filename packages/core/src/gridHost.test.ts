// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createClientGrid } from './createGrid.js';
import { mountGridHost } from './gridHost.js';

class TestResizeObserver {
	public observe = vi.fn();
	public disconnect = vi.fn();
}

describe('mountGridHost', () => {
	afterEach(() => {
		document.body.textContent = '';
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('exposes internal render stats and reset hooks through the host', () => {
		vi.stubGlobal('ResizeObserver', TestResizeObserver);
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const api = createClientGrid({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			rows: Array.from({ length: 80 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
			getRowId: (row) => row.id,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const host = mountGridHost(api, container);
		host.resetRenderStats();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 800;
		scrollViewport.dispatchEvent(new Event('scroll'));

		expect(host.getRenderStats().scrollFrames).toBe(1);
		host.resetRenderStats();
		expect(host.getRenderStats().scrollFrames).toBe(0);

		host.destroy();
		api.destroy();
	});
});
