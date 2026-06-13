import type { CSSProperties, ReactNode } from 'react';
import { useGridApi, useGridKeySelector } from './hooks.js';

export interface GridStatusBarProps {
	className?: string;
	style?: CSSProperties;
	left?: ReactNode;
	right?: ReactNode;
}

export function GridStatusBar({ className, style, left, right }: GridStatusBarProps) {
	const api = useGridApi();
	const selectedRowIds = useGridKeySelector('selectedRowIds', (state) => state.selectedRowIds);
	const activeEdit = useGridKeySelector('activeEdit', (state) => state.activeEdit);
	const dataRowCount = useGridKeySelector('globalVersion', () => api.rows().getCount());

	const leftContent = left ?? (
		<div className='flex items-center gap-3 text-[11px] font-semibold text-slate-400'>
			<span className='text-slate-500'>
				<span className='text-slate-200 tabular-nums'>{dataRowCount}</span> rows
			</span>
			<span className='text-slate-500'>
				<span className='text-slate-200 tabular-nums'>{dataRowCount}</span> visible
			</span>
			<span className='text-slate-500'>
				<span className='text-slate-200 tabular-nums'>{selectedRowIds.length}</span> selected
			</span>
		</div>
	);

	const rightContent = right ?? (
		<div className='flex items-center gap-1.5 text-[11px] font-semibold text-slate-500'>
			{activeEdit ? (
				<span className='tabular-nums text-slate-300'>
					Editing <span className='text-white'>{activeEdit.rowId}</span>
					<span className='text-slate-500'>:</span>
					<span className='text-white'>{activeEdit.colField}</span>
				</span>
			) : (
				<span>Ready</span>
			)}
		</div>
	);

	return (
		<div className={className ?? 'flex items-center justify-between gap-3 border-t border-slate-800 bg-slate-950/90 px-3 py-2'} style={style}>
			{leftContent}
			<div className='flex-1' />
			{rightContent}
		</div>
	);
}
