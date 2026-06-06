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

	it('updates row portal content when visual row props change without remounting stable rows', () => {
		const manager = new PortalMountManager();
		const mountRow = vi.fn();
		manager.onMountRowContent = mountRow;
		const container = document.createElement('div');
		const collapsed = {
			kind: 'group' as const,
			id: 'group:dept:A',
			field: 'dept',
			key: 'A',
			depth: 0,
			expanded: false,
			childCount: 2,
			height: 40,
		};
		const expanded = { ...collapsed, expanded: true };

		manager.mountRow({ rowKey: collapsed.id, container, visualRow: collapsed });
		manager.mountRow({ rowKey: collapsed.id, container, visualRow: collapsed });
		manager.mountRow({ rowKey: expanded.id, container, visualRow: expanded });

		expect(mountRow).toHaveBeenCalledTimes(2);
		expect(mountRow.mock.calls[1][0].visualRow).toBe(expanded);
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

	it('flushes deferred portal work in bounded chunks', () => {
		const manager = new PortalMountManager();
		const release = vi.fn();
		manager.onUnmountCellContent = release;

		for (let index = 0; index < 8; index++) {
			manager.mountCell({
				cellKey: `r${index}:name`,
				container: document.createElement('div'),
				value: `A${index}`,
				node: {} as never,
				col: { field: 'name', header: 'Name' },
				isEditing: false,
				isLoading: false,
			});
		}
		manager.setScrolling(true);
		for (let index = 0; index < 8; index++) {
			manager.releaseCell({ cellKey: `r${index}:name` });
		}
		manager.setScrolling(false);

		const first = manager.flushDeferred({ maxItems: 3, reason: 'scroll-idle' });

		expect(first.processed).toBe(3);
		expect(first.remaining).toBe(5);
		expect(release).toHaveBeenCalledTimes(3);
		expect(manager.getScrollStats()).toMatchObject({
			portalFlushChunks: 1,
			maxPortalOpsFlushedInOneChunk: 3,
		});

		const second = manager.flushDeferred({ maxItems: 50, reason: 'scroll-idle' });
		expect(second.processed).toBe(5);
		expect(second.remaining).toBe(0);
		expect(release).toHaveBeenCalledTimes(8);
		expect(manager.getScrollStats().maxPortalOpsFlushedInOneChunk).toBe(5);
	});

	it('keeps scrolled-out custom renderers in a warm root and removes it on cleanup', () => {
		const manager = new PortalMountManager();
		const mount = vi.fn();
		const release = vi.fn();
		const parent = document.createElement('div');
		document.body.appendChild(parent);
		manager.onMountCellContent = mount;
		manager.onUnmountCellContent = release;

		manager.mountCell({
			cellKey: 'logical-1',
			container: parent,
			value: 'A',
			node: { id: 'row-1' } as never,
			col: { field: 'name', header: 'Name', cellRenderer: vi.fn() },
			rowIndex: 0,
			colIndex: 0,
			isEditing: false,
			isLoading: false,
		});

		expect(parent.querySelectorAll('.og-custom-renderer-container')).toHaveLength(1);

		manager.setScrolling(true);
		manager.releaseCell({ cellKey: 'logical-1', container: parent });
		manager.setScrolling(false);
		manager.flushDeferred();

		const warmRoot = document.body.querySelector('.og-hidden-renderer-container');
		expect(warmRoot).not.toBeNull();
		expect(warmRoot?.querySelectorAll('.og-custom-renderer-container')).toHaveLength(1);
		expect(release).not.toHaveBeenCalled();

		manager.releaseAll();

		expect(release).toHaveBeenCalledTimes(1);
		expect(document.body.querySelector('.og-hidden-renderer-container')).toBeNull();
	});

	it('rebinds a warm custom renderer by renderer slot key without leaving stale parent DOM', () => {
		const manager = new PortalMountManager();
		const mount = vi.fn();
		const release = vi.fn();
		const firstParent = document.createElement('div');
		const secondParent = document.createElement('div');
		manager.onMountCellContent = mount;
		manager.onUnmountCellContent = release;
		const col = { field: 'name', header: 'Name', cellRenderer: vi.fn() };

		manager.mountCell({
			cellKey: 'row-1:name',
			container: firstParent,
			value: 'A',
			node: { id: 'row-1' } as never,
			col,
			rowIndex: 0,
			colIndex: 0,
			isEditing: false,
			isLoading: false,
		});
		manager.setScrolling(true);
		manager.releaseCell({ cellKey: 'row-1:name', container: firstParent });
		manager.setScrolling(false);
		manager.flushDeferred();

		manager.mountCell({
			cellKey: 'row-2:name',
			container: secondParent,
			value: 'B',
			node: { id: 'row-2' } as never,
			col,
			rowIndex: 0,
			colIndex: 0,
			isEditing: false,
			isLoading: false,
		});

		expect(firstParent.querySelector('.og-custom-renderer-container')).toBeNull();
		expect(secondParent.querySelectorAll('.og-custom-renderer-container')).toHaveLength(1);
		expect(manager.getScrollStats().portalFlushChunks).toBe(1);
		expect(mount).toHaveBeenCalledTimes(2);
		expect(release).not.toHaveBeenCalled();
		manager.releaseAll();
		expect(release).toHaveBeenCalledTimes(1);
	});

	it('destroys the previous custom renderer when a physical parent is rebound to a new slot key', () => {
		const manager = new PortalMountManager();
		const release = vi.fn();
		const parent = document.createElement('div');
		const col = { field: 'name', header: 'Name', cellRenderer: vi.fn() };
		manager.onUnmountCellContent = release;

		manager.mountCell({
			cellKey: 'row-1:name',
			container: parent,
			value: 'A',
			node: { id: 'row-1' } as never,
			col,
			rowIndex: 0,
			colIndex: 0,
			isEditing: false,
			isLoading: false,
		});
		manager.mountCell({
			cellKey: 'row-2:name',
			container: parent,
			value: 'B',
			node: { id: 'row-2' } as never,
			col,
			rowIndex: 1,
			colIndex: 0,
			isEditing: false,
			isLoading: false,
		});

		expect(parent.querySelectorAll('.og-custom-renderer-container')).toHaveLength(1);
		expect(release).toHaveBeenCalledTimes(1);
		expect(release.mock.calls[0][0].cellKey).toBe('row-1:name');
	});
});
