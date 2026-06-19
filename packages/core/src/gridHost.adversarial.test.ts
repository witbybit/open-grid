// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createClientGrid } from './createGrid.js';
import { mountGridHost } from './gridHost.js';
import { resolveGridInternalRuntime } from './internal/apiInternalBridge.js';

class TestResizeObserver {
	public static instances: TestResizeObserver[] = [];

	private readonly callback: ResizeObserverCallback;

	public observe = vi.fn();
	public disconnect = vi.fn();

	public constructor(callback: ResizeObserverCallback) {
		this.callback = callback;
		TestResizeObserver.instances.push(this);
	}

	public emit(width: number, height: number): void {
		this.callback(
			[
				{
					target: document.createElement('div'),
					contentRect: {
						x: 0,
						y: 0,
						top: 0,
						left: 0,
						right: width,
						bottom: height,
						width,
						height,
						toJSON: () => ({}),
					},
				} as ResizeObserverEntry,
			],
			this as unknown as ResizeObserver
		);
	}

	public static reset(): void {
		TestResizeObserver.instances = [];
	}
}

function createContainer(width = 640, height = 240): HTMLDivElement {
	const container = document.createElement('div');
	vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: width,
		bottom: height,
		width,
		height,
		toJSON: () => ({}),
	});
	document.body.appendChild(container);
	return container;
}

describe('mountGridHost adversarial lifecycle', () => {
	afterEach(() => {
		document.body.textContent = '';
		TestResizeObserver.reset();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('ignores stale resize observer callbacks after a newer binding becomes active', () => {
		vi.stubGlobal('ResizeObserver', TestResizeObserver);
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});

		const api = createClientGrid({
			columns: [{ field: 'name', header: 'Name', width: 160 }],
			rows: [{ id: 'row-1', name: 'Row 1' }],
			getRowId: (row) => row.id,
		});
		const runtime = resolveGridInternalRuntime(api);
		const container1 = createContainer(500, 180);
		const container2 = createContainer(700, 260);

		const host1 = mountGridHost(api, container1);
		const observer1 = TestResizeObserver.instances[0];
		host1.destroy();

		const host2 = mountGridHost(api, container2);
		const observer2 = TestResizeObserver.instances[1];

		const setViewportSizeSpy = vi.spyOn(runtime.api, 'setViewportSize').mockReturnValue(true);
		const updateVisibleRangesSpy = vi.spyOn(runtime.api, 'updateVisibleRanges').mockReturnValue(true);

		observer1.emit(333, 111);
		expect(setViewportSizeSpy).not.toHaveBeenCalled();
		expect(updateVisibleRangesSpy).not.toHaveBeenCalled();

		observer2.emit(444, 222);
		expect(setViewportSizeSpy).toHaveBeenCalledWith(444, 222);
		expect(updateVisibleRangesSpy).toHaveBeenCalledTimes(1);

		host2.destroy();
		api.destroy();
	});

	it('stale destroy from an old host faults without corrupting the current binding', () => {
		vi.stubGlobal('ResizeObserver', TestResizeObserver);
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});

		const api = createClientGrid({
			columns: [{ field: 'name', header: 'Name', width: 160 }],
			rows: [{ id: 'row-1', name: 'Row 1' }],
			getRowId: (row) => row.id,
		});
		const runtime = resolveGridInternalRuntime(api);

		const host1 = mountGridHost(api, createContainer());
		host1.destroy();

		const host2 = mountGridHost(api, createContainer());
		host1.destroy();

		const faults = runtime.api.getRuntimeFaults();
		expect(faults.some((fault) => fault.operation === 'unbindRuntimePorts')).toBe(true);
		expect(host2.getRenderStats()).toBeTruthy();

		host2.destroy();
		api.destroy();
	});

	it('supports repeated remount loops on the same api without accumulating runtime faults', { timeout: 10000 }, () => {
		vi.stubGlobal('ResizeObserver', TestResizeObserver);
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});

		const api = createClientGrid({
			columns: [{ field: 'name', header: 'Name', width: 160 }],
			rows: Array.from({ length: 25 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
			getRowId: (row) => row.id,
		});
		const runtime = resolveGridInternalRuntime(api);

		for (let iteration = 0; iteration < 20; iteration++) {
			const host = mountGridHost(api, createContainer(480 + iteration, 180 + iteration));
			const observer = TestResizeObserver.instances.at(-1);
			expect(observer).toBeDefined();
			observer?.emit(520 + iteration, 200 + iteration);
			host.destroy();
		}

		expect(runtime.api.getRuntimeFaults()).toEqual([]);
		api.destroy();
	});
});
