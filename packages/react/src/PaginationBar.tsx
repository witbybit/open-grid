import { useSyncExternalStore } from 'react';
import type { GridApi } from '@open-grid/core';

interface PaginationBarProps {
	api: GridApi<unknown>;
}

export function PaginationBar({ api }: PaginationBarProps) {
	const p = api.pagination;

	useSyncExternalStore(
		p.subscribe,
		() => p.getCurrentPage(),
		() => p.getCurrentPage()
	);

	if (!p.hasPagination()) return null;

	const currentPage = p.getCurrentPage();
	const pageCount = p.getPageCount();
	const startRow = p.getStartRowIndex() + 1;
	const endRow = p.getEndRowIndex();
	const total = p.getTotalRows();

	const btnStyle = {
		padding: '2px 8px',
		fontSize: '12px',
		border: '1px solid var(--og-border, #ddd)',
		borderRadius: '3px',
		background: 'transparent',
		cursor: 'pointer',
		color: 'inherit',
	} as const;

	const disabledStyle = { ...btnStyle, opacity: 0.4, cursor: 'default' } as const;

	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: '8px',
				padding: '0 12px',
				height: '36px',
				borderTop: '1px solid var(--og-border, #e0e0e0)',
				background: 'var(--og-header-bg, #f5f5f5)',
				fontSize: '12px',
				color: 'var(--og-cell-text, #444)',
				flexShrink: 0,
				justifyContent: 'flex-end',
			}}
		>
			<span style={{ color: 'var(--og-cell-text-muted, #777)' }}>
				{startRow}–{endRow} of {total.toLocaleString()}
			</span>

			<button onClick={() => p.firstPage()} disabled={!p.hasPrevPage()} style={p.hasPrevPage() ? btnStyle : disabledStyle} title='First page'>
				«
			</button>
			<button onClick={() => p.prevPage()} disabled={!p.hasPrevPage()} style={p.hasPrevPage() ? btnStyle : disabledStyle} title='Previous page'>
				‹
			</button>

			<span style={{ fontWeight: 500 }}>
				Page {currentPage} of {pageCount}
			</span>

			<button onClick={() => p.nextPage()} disabled={!p.hasNextPage()} style={p.hasNextPage() ? btnStyle : disabledStyle} title='Next page'>
				›
			</button>
			<button onClick={() => p.lastPage()} disabled={!p.hasNextPage()} style={p.hasNextPage() ? btnStyle : disabledStyle} title='Last page'>
				»
			</button>

			<select
				value={p.getPageSize()}
				onChange={(e) => p.setPageSize(Number(e.target.value))}
				style={{ ...btnStyle, padding: '2px 4px' }}
				title='Rows per page'
			>
				{[25, 50, 100, 200, 500].map((n) => (
					<option key={n} value={n}>
						{n} / page
					</option>
				))}
			</select>
		</div>
	);
}
