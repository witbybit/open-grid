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
});
