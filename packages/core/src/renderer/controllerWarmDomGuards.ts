import type { CellCtrl } from './controllers/CellCtrl.js';
import type { CellSlot } from './cellSlot.js';
import { matchesCellSlotMountedFreshness } from './cellSlot.js';

export function canReuseSlotDomForCellCtrl<TRowData>(cellSlot: CellSlot<TRowData>, cellCtrl: CellCtrl): boolean {
	if (cellSlot.rowId !== cellCtrl.rowId) return false;
	if (cellSlot.columnInstanceId !== cellCtrl.columnInstanceId) return false;
	if (cellCtrl.lifecycle.attachedSlotInstanceId && cellCtrl.lifecycle.attachedSlotInstanceId !== cellSlot.cellInstanceId) return false;
	if (!cellCtrl.freshness) return false;
	return matchesCellSlotMountedFreshness(cellSlot, {
		rowVersion: cellCtrl.freshness.rowVersion,
		globalVersion: cellCtrl.freshness.globalVersion,
		visualVersions: {
			insightVersion: cellCtrl.freshness.insightVersion,
			styleVersion: cellCtrl.freshness.styleVersion,
			loadingVersion: cellCtrl.freshness.loadingVersion,
			selectionVersion: cellCtrl.freshness.selectionVersion,
		},
	});
}

export function mustClearSlotForControllerChange<TRowData>(cellSlot: CellSlot<TRowData>, cellCtrl: CellCtrl): boolean {
	if (cellSlot.rowId !== '' && cellSlot.rowId !== cellCtrl.rowId) return true;
	if (cellSlot.columnInstanceId !== '' && cellSlot.columnInstanceId !== cellCtrl.columnInstanceId) return true;
	if (cellCtrl.lifecycle.attachedSlotInstanceId && cellCtrl.lifecycle.attachedSlotInstanceId !== cellSlot.cellInstanceId) return true;
	return false;
}

export function canFreezePortalForCellCtrl<TRowData>(cellSlot: CellSlot<TRowData>, cellCtrl: CellCtrl): boolean {
	if (mustClearSlotForControllerChange(cellSlot, cellCtrl)) return false;
	if (!cellCtrl.rendererState.portalKey) return false;
	if (cellSlot.lastContentMode !== 'portal') return false;
	return cellSlot.lastPortalKey === cellCtrl.rendererState.portalKey;
}
