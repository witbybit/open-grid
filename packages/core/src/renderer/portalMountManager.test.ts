// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { PortalMountManager } from './portalMountManager.js';

describe('PortalMountManager', () => {
	it('tracks cell portal mount, update, release, and cleanup without DOM method patches', () => {
		const manager = new PortalMountManager();
		const mount = vi.fn();
		const release = vi.fn();
		const container = document.createElement('div');

		manager.onMountCellContent = mount;
		manager.onUnmountCellContent = release;

		manager.mountCell({
			cellKey: 'r1:name',
			container,
			value: 'A',
			node: {} as never,
			col: { field: 'name', header: 'Name' },
			isEditing: false,
			isLoading: false,
		});

		expect(manager.getStats().cells).toBe(1);
		expect(Object.hasOwn(container, '__patchedRemoveChild')).toBe(false);

		manager.mountCell({
			cellKey: 'r1:name',
			container,
			value: 'B',
			node: {} as never,
			col: { field: 'name', header: 'Name' },
			isEditing: false,
			isLoading: false,
		});
		expect(manager.getStats().cells).toBe(1);
		expect(mount).toHaveBeenCalledTimes(2);

		manager.releaseCell({ cellKey: 'r1:name', container, flushSync: true });
		expect(manager.getStats().cells).toBe(0);
		expect(release).toHaveBeenCalledWith({ cellKey: 'r1:name', container, flushSync: true });
	});

	it('releases all tracked portal mounts on cleanup', () => {
		const manager = new PortalMountManager();
		const releaseCell = vi.fn();
		const releaseRow = vi.fn();
		const releaseMenu = vi.fn();
		manager.onUnmountCellContent = releaseCell;
		manager.onUnmountRowContent = releaseRow;
		manager.onUnmountHeaderMenu = releaseMenu;

		manager.mountCell({
			cellKey: 'r1:name',
			container: document.createElement('div'),
			value: 'A',
			node: {} as never,
			col: { field: 'name', header: 'Name' },
			isEditing: false,
			isLoading: false,
		});
		manager.mountRow({
			rowKey: 'detail:1',
			container: document.createElement('div'),
			visualRow: { kind: 'detail', id: 'detail:1', parentId: '1', depth: 0, height: 40, render: null },
		});
		manager.mountHeaderMenu({
			colField: 'name',
			container: document.createElement('div'),
			column: { field: 'name', header: 'Name' },
			close: vi.fn(),
		});

		manager.releaseAll();

		expect(manager.getStats()).toEqual({ cells: 0, rows: 0, menus: 0 });
		expect(releaseCell).toHaveBeenCalledTimes(1);
		expect(releaseRow).toHaveBeenCalledTimes(1);
		expect(releaseMenu).toHaveBeenCalledTimes(1);
	});

	it('defers row portal mounts and releases while scrolling', () => {
		const manager = new PortalMountManager();
		const mountRow = vi.fn();
		const releaseRow = vi.fn();
		manager.onMountRowContent = mountRow;
		manager.onUnmountRowContent = releaseRow;

		const firstContainer = document.createElement('div');
		const secondContainer = document.createElement('div');

		manager.setScrolling(true);
		manager.mountRow({
			rowKey: 'detail:1',
			container: firstContainer,
			visualRow: { kind: 'detail', id: 'detail:1', parentId: '1', depth: 0, height: 40, render: null },
		});
		manager.releaseRow({ rowKey: 'detail:1', container: firstContainer });
		manager.mountRow({
			rowKey: 'detail:2',
			container: secondContainer,
			visualRow: { kind: 'detail', id: 'detail:2', parentId: '2', depth: 0, height: 40, render: null },
		});

		expect(mountRow).not.toHaveBeenCalled();
		expect(releaseRow).not.toHaveBeenCalled();
		expect(manager.getScrollStats()).toMatchObject({
			portalMountsDuringScroll: 2,
			portalReleasesDuringScroll: 1,
		});

		manager.setScrolling(false);
		manager.flushDeferred();

		expect(releaseRow).not.toHaveBeenCalled();
		expect(mountRow).toHaveBeenCalledTimes(1);
		expect(mountRow.mock.calls[0][0].rowKey).toBe('detail:2');
	});

	it('defers cell portal mounts while scrolling and drops transient cells before flush', () => {
		const manager = new PortalMountManager();
		const mount = vi.fn();
		const release = vi.fn();
		const stableContainer = document.createElement('div');
		const transientContainer = document.createElement('div');
		manager.onMountCellContent = mount;
		manager.onUnmountCellContent = release;

		manager.setScrolling(true);
		manager.mountCell({
			cellKey: 'r1:name',
			container: stableContainer,
			value: 'A',
			node: {} as never,
			col: { field: 'name', header: 'Name' },
			isEditing: false,
			isLoading: false,
		});
		manager.mountCell({
			cellKey: 'r2:name',
			container: transientContainer,
			value: 'B',
			node: {} as never,
			col: { field: 'name', header: 'Name' },
			isEditing: false,
			isLoading: false,
		});
		manager.releaseCell({ cellKey: 'r2:name', container: transientContainer });

		expect(mount).not.toHaveBeenCalled();
		expect(release).not.toHaveBeenCalled();
		expect(manager.getScrollStats()).toMatchObject({
			portalMountsDuringScroll: 2,
			portalReleasesDuringScroll: 1,
		});

		manager.setScrolling(false);
		manager.flushDeferred();

		expect(release).not.toHaveBeenCalled();
		expect(mount).toHaveBeenCalledTimes(1);
		expect(mount.mock.calls[0][0].cellKey).toBe('r1:name');
	});

	it('suppresses synchronous cell portal flushes while scrolling', () => {
		const manager = new PortalMountManager();
		const release = vi.fn();
		const flush = vi.fn();
		const container = document.createElement('div');
		manager.onUnmountCellContent = release;
		manager.onFlushCellContent = flush;

		manager.mountCell({
			cellKey: 'r1:name',
			container,
			value: 'A',
			node: {} as never,
			col: { field: 'name', header: 'Name' },
			isEditing: false,
			isLoading: false,
		});

		manager.setScrolling(true);
		manager.releaseCells([{ cellKey: 'r1:name', container }], true);

		expect(release).not.toHaveBeenCalled();
		expect(flush).not.toHaveBeenCalled();
		expect(manager.getScrollStats().portalFlushesDuringScroll).toBe(0);

		manager.setScrolling(false);
		manager.flushDeferred(true);

		expect(release).toHaveBeenCalledWith({ cellKey: 'r1:name', container, flushSync: false });
		expect(flush).toHaveBeenCalledWith({ flushSync: true });
		expect(manager.getScrollStats().portalFlushesDuringScroll).toBe(0);
	});
});
