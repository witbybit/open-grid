import { useCallback, useEffect, useRef, useState } from 'react';
import { ColumnDef, GridApi, RowNode } from '@open-grid/core';
import { createPortal } from 'react-dom';
import { GridProvider, useGridApi } from './OpenGrid.js';
import type { ReactNode } from 'react';

export interface PortalCellProps<TRowData = unknown> {
	rowId: string;
	colField: string;
	value: unknown;
	col: ColumnDef<TRowData>;
	node: RowNode<TRowData>;
	isEditing: boolean;
	isLoading: boolean;
}

/**
 * Clean React Portal cell adapter that mounts only custom renderers & custom editors.
 */
export function PortalCell<TRowData = unknown>({ rowId, colField, value, col, node, isEditing, isLoading }: PortalCellProps<TRowData>) {
	const api = useGridApi<TRowData>();

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
				} else if (isEditing && !isCommittedRef.current) {
					isCommittedRef.current = true;
					api.setCellValue(rowId, colField, localValueRef.current);
				}
			}
		});
		return () => {
			unsubscribe();
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

	const CustomEditor = col?.cellEditor as ((props: Record<string, unknown>) => ReactNode) | undefined;
	const CustomRenderer = col?.cellRenderer as ((props: Record<string, unknown>) => ReactNode) | undefined;

	return (
		<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center' }}>
			{isEditing ? (
				CustomEditor ? (
					<div
						style={{ width: '100%', height: '100%' }}
						onMouseDown={(e) => e.stopPropagation()}
						onDoubleClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => {
							if (e.defaultPrevented) return;
							if (e.key === 'Enter') {
								e.stopPropagation();
								handleCommit();
							} else if (e.key === 'Escape') {
								e.stopPropagation();
								handleCancel();
							}
						}}
					>
						{CustomEditor({
							rowId,
							colField,
							value: localValue,
							onChange: (val: unknown) => {
								setLocalValue(val);
								localValueRef.current = val;
							},
							api,
							onCommit: handleCommit,
							onCancel: handleCancel,
						})}
					</div>
				) : (
					<input
						autoFocus
						className='og-cell-editor'
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
				CustomRenderer({ value, computedValue: value, row: rowData, rowId, colField, api })
			) : null}
		</div>
	);
}

export interface PortalData<TRowData = unknown> {
	cellKey: string;
	container: HTMLElement;
	value: unknown;
	node: RowNode<TRowData>;
	col: ColumnDef<TRowData>;
	isEditing: boolean;
	isLoading: boolean;
}

export function DefaultGroupRowRenderer({ visualRow, api }: { visualRow: any; api: GridApi<any> }) {
	const expanded = visualRow.expanded;
	const depth = visualRow.depth;

	const handleToggle = (e: React.MouseEvent) => {
		e.stopPropagation();
		api.toggleGroupExpanded(visualRow.id);
	};

	return (
		<div
			className="og-group-row-content"
			style={{
				display: 'flex',
				alignItems: 'center',
				paddingLeft: `${depth * 20 + 8}px`,
				height: '100%',
				width: '100%',
				userSelect: 'none',
				cursor: 'pointer',
				fontSize: '13px',
				fontWeight: '600',
				color: '#e2e8f0',
			}}
			onClick={handleToggle}
		>
			<span style={{ marginRight: '8px', transition: 'transform 0.15s ease', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>
				▶
			</span>
			<span style={{ opacity: 0.6, marginRight: '6px', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.5px' }}>
				{visualRow.field}:
			</span>
			<span>
				{String(visualRow.key)}
			</span>
			<span
				className="og-group-count"
				style={{
					marginLeft: '10px',
					background: 'rgba(59, 130, 246, 0.2)',
					border: '1px solid rgba(59, 130, 246, 0.4)',
					color: '#60a5fa',
					padding: '1px 6px',
					borderRadius: '10px',
					fontSize: '11px',
				}}
			>
				{visualRow.childCount} items
			</span>
		</div>
	);
}

export function DefaultDetailRowRenderer({ visualRow, api }: { visualRow: any; api: GridApi<any> }) {
	return (
		<div
			className="og-detail-row-content"
			style={{
				display: 'flex',
				alignItems: 'center',
				paddingLeft: '24px',
				height: '100%',
				width: '100%',
				background: 'rgba(255, 255, 255, 0.02)',
				borderBottom: '1px dashed rgba(255, 255, 255, 0.05)',
				color: '#a0aec0',
				fontSize: '12px',
				fontStyle: 'italic',
			}}
		>
			Nested detail view for parent row: {visualRow.parentId}
		</div>
	);
}

export interface PortalManagerProps<TRowData = unknown> {
	portals: Map<string, PortalData<TRowData>>;
	rowPortals?: Map<string, { rowKey: string; container: HTMLElement; visualRow: any }>;
	api: GridApi<TRowData>;
	groupRowRenderer?: (props: { visualRow: any; api: GridApi<TRowData> }) => React.ReactNode;
	detailRowRenderer?: (props: { visualRow: any; api: GridApi<TRowData> }) => React.ReactNode;
}

export function PortalManager<TRowData = unknown>({
	portals,
	rowPortals = new Map(),
	api,
	groupRowRenderer,
	detailRowRenderer,
}: PortalManagerProps<TRowData>) {
	return (
		<>
			{Array.from(portals.values()).map((p) => {
				return createPortal(
					<GridProvider api={api} key={p.cellKey}>
						<PortalCell<TRowData>
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
			{Array.from(rowPortals.values()).map((rp) => {
				const { rowKey, container, visualRow } = rp;
				let content: React.ReactNode = null;
				if (visualRow.kind === 'group') {
					content = groupRowRenderer
						? groupRowRenderer({ visualRow, api })
						: <DefaultGroupRowRenderer visualRow={visualRow} api={api} />;
				} else if (visualRow.kind === 'detail') {
					content = detailRowRenderer
						? detailRowRenderer({ visualRow, api })
						: <DefaultDetailRowRenderer visualRow={visualRow} api={api} />;
				}
				return createPortal(
					<GridProvider api={api} key={rowKey}>
						{content}
					</GridProvider>,
					container
				);
			})}
		</>
	);
}

