import { useCallback, useEffect, useRef, useState } from 'react';
import { GridStore } from '@open-grid/core';
import { createPortal } from 'react-dom';
import { GridProvider, useGridApi } from './OpenGrid';

export interface PortalCellProps {
	rowId: string;
	colField: string;
	value: unknown;
	col: any;
	node: any;
	isEditing: boolean;
	isLoading: boolean;
}

/**
 * Clean React Portal cell adapter that mounts only custom renderers & custom editors.
 */
export function PortalCell({ rowId, colField, value, col, node, isEditing, isLoading }: PortalCellProps) {
	const api = useGridApi();

	const [localValue, setLocalValue] = useState<unknown>(value);

	const localValueRef = useRef(localValue);
	localValueRef.current = localValue;

	const isCancelledRef = useRef(false);
	const isCommittedRef = useRef(!isEditing);

	useEffect(() => {
		if (isEditing) {
			isCancelledRef.current = false;
			isCommittedRef.current = false;
			setLocalValue(value);
		}
	}, [isEditing, value]);

	useEffect(() => {
		const unsubscribe = api.addEventListener<{ rowId: string; colField: string; cancel: boolean }>('editStopped', (event) => {
			if (event.payload.rowId === rowId && event.payload.colField === colField) {
				if (event.payload.cancel) {
					isCancelledRef.current = true;
				}
			}
		});
		return () => {
			unsubscribe();
			if (isEditing && !isCancelledRef.current && !isCommittedRef.current) {
				isCommittedRef.current = true;
				api.setCellValue(rowId, colField, localValueRef.current);
			}
		};
	}, [isEditing, api, rowId, colField]);

	const handleCommit = useCallback(
		(finalValue?: unknown) => {
			isCommittedRef.current = true;
			const isEvent = finalValue && typeof finalValue === 'object' && ('nativeEvent' in finalValue || 'target' in finalValue);
			const valToCommit = finalValue !== undefined && !isEvent ? finalValue : localValueRef.current;
			api.setCellValue(rowId, colField, valToCommit);
			api.stopEditing();
		},
		[api, rowId, colField]
	);

	const handleCancel = useCallback(() => {
		isCancelledRef.current = true;
		api.stopEditing(true);
	}, [api]);

	if (isLoading) {
		return (
			<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', padding: '0 12px' }}>
				<div className='og-cell-loading-skeleton' style={{ height: '16px', width: '80%', borderRadius: '4px' }} />
			</div>
		);
	}

	const rowData = node?.data;

	const CustomEditor = col?.cellEditor;
	const CustomRenderer = col?.cellRenderer;

	return (
		<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center' }}>
			{isEditing ? (
				CustomEditor ? (
					<CustomEditor
						rowId={rowId}
						colField={colField}
						value={localValue}
						onChange={(val: any) => {
							setLocalValue(val);
							localValueRef.current = val;
						}}
						api={api}
						onCommit={handleCommit}
						onCancel={handleCancel}
					/>
				) : (
					<input
						autoFocus
						className='absolute inset-0 w-full h-full px-3 text-sm bg-slate-900 text-white border-2 border-purple-500 outline-none z-20'
						value={typeof localValue === 'string' || typeof localValue === 'number' ? String(localValue) : ''}
						onChange={(e) => {
							setLocalValue(e.target.value);
							localValueRef.current = e.target.value;
						}}
						onMouseDown={(e) => e.stopPropagation()}
						onDoubleClick={(e) => e.stopPropagation()}
						onBlur={() => handleCommit()}
						onKeyDown={(e) => {
							if (e.key === 'Enter') {
								e.stopPropagation();
								handleCommit();
							} else if (e.key === 'Escape') {
								e.stopPropagation();
								handleCancel();
							}
						}}
					/>
				)
			) : CustomRenderer && rowData ? (
				<CustomRenderer value={value} computedValue={value} row={rowData} rowId={rowId} colField={colField} api={api} />
			) : null}
		</div>
	);
}

export interface PortalData {
	cellKey: string;
	container: HTMLElement;
	value: unknown;
	node: any;
	col: any;
	isEditing: boolean;
	isLoading: boolean;
}

export interface PortalManagerProps {
	portals: Map<string, PortalData>;
	store: GridStore<any>;
}

export function PortalManager({ portals, store }: PortalManagerProps) {
	return (
		<>
			{Array.from(portals.values()).map((p) => {
				return createPortal(
					<GridProvider store={store} key={p.cellKey}>
						<PortalCell
							rowId={p.node.id}
							colField={p.col.field}
							value={p.value}
							col={p.col}
							node={p.node}
							isEditing={p.isEditing}
							isLoading={p.isLoading}
						/>
					</GridProvider>,
					p.container
				);
			})}
		</>
	);
}
