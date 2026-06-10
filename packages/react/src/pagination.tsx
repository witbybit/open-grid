import { useState, useMemo, useCallback } from 'react';

export interface ClientGridPaginationResult<TRowData> {
	page: number;
	pageCount: number;
	pageSize: number;
	totalRows: number;
	pageRows: TRowData[];
	setPage: (page: number) => void;
	nextPage: () => void;
	prevPage: () => void;
	canNextPage: boolean;
	canPrevPage: boolean;
}

/**
 * Manages client-side pagination state for an array of rows.
 *
 * @example
 * const { pageRows, page, pageCount, setPage } = useClientGridPagination(allRows, { pageSize: 50 });
 * return (
 *   <div>
 *     <OpenGrid rows={pageRows} columns={cols} />
 *     <GridPagination page={page} pageCount={pageCount} onPageChange={setPage} />
 *   </div>
 * );
 */
export function useClientGridPagination<TRowData>(allRows: TRowData[], options: { pageSize: number }): ClientGridPaginationResult<TRowData> {
	const { pageSize } = options;
	const [page, setPageRaw] = useState(0);

	const totalRows = allRows.length;
	const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
	const clampedPage = Math.min(page, pageCount - 1);

	const pageRows = useMemo(() => allRows.slice(clampedPage * pageSize, (clampedPage + 1) * pageSize), [allRows, clampedPage, pageSize]);

	const setPage = useCallback((p: number) => setPageRaw(Math.max(0, Math.min(p, pageCount - 1))), [pageCount]);

	const nextPage = useCallback(() => setPage(clampedPage + 1), [setPage, clampedPage]);
	const prevPage = useCallback(() => setPage(clampedPage - 1), [setPage, clampedPage]);

	return {
		page: clampedPage,
		pageCount,
		pageSize,
		totalRows,
		pageRows,
		setPage,
		nextPage,
		prevPage,
		canNextPage: clampedPage < pageCount - 1,
		canPrevPage: clampedPage > 0,
	};
}

export interface GridPaginationProps {
	page: number;
	pageCount: number;
	onPageChange: (page: number) => void;
	/** Total row count shown in the info label. */
	totalRows?: number;
	/** Rows per page shown in the info label. */
	pageSize?: number;
	/** Derived from `page` and `pageCount` by default. Override to control externally. */
	canNextPage?: boolean;
	/** Derived from `page` and `pageCount` by default. Override to control externally. */
	canPrevPage?: boolean;
	/** Additional className for the root container. */
	className?: string;
	/** Additional inline styles for the root container. */
	style?: React.CSSProperties;
	/** Maximum number of page buttons to display before collapsing to ellipsis. Default: 7 */
	maxPageButtons?: number;
	/** Custom renderer for the "previous page" button content. */
	renderPrevButton?: (disabled: boolean) => React.ReactNode;
	/** Custom renderer for the "next page" button content. */
	renderNextButton?: (disabled: boolean) => React.ReactNode;
	/** Custom renderer for the page info text. */
	renderPageInfo?: (page: number, pageCount: number, totalRows?: number) => React.ReactNode;
}

function getPageNumbers(currentPage: number, pageCount: number, maxButtons: number): (number | 'ellipsis-start' | 'ellipsis-end')[] {
	if (pageCount <= maxButtons) {
		return Array.from({ length: pageCount }, (_, i) => i);
	}
	const half = Math.floor((maxButtons - 2) / 2);
	let start = Math.max(1, currentPage - half);
	let end = Math.min(pageCount - 2, start + (maxButtons - 4));
	if (end - start < maxButtons - 4) start = Math.max(1, end - (maxButtons - 4));

	const pages: (number | 'ellipsis-start' | 'ellipsis-end')[] = [0];
	if (start > 1) pages.push('ellipsis-start');
	for (let i = start; i <= end; i++) pages.push(i);
	if (end < pageCount - 2) pages.push('ellipsis-end');
	pages.push(pageCount - 1);
	return pages;
}

const baseContainerStyle: React.CSSProperties = {
	display: 'flex',
	alignItems: 'center',
	gap: '4px',
	padding: '8px',
	userSelect: 'none',
};

const baseBtnStyle: React.CSSProperties = {
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	minWidth: '32px',
	height: '32px',
	padding: '0 6px',
	border: '1px solid var(--og-pagination-border, #334155)',
	borderRadius: '4px',
	background: 'var(--og-pagination-bg, transparent)',
	color: 'var(--og-pagination-color, inherit)',
	fontSize: '13px',
	cursor: 'pointer',
	transition: 'background 120ms, border-color 120ms',
};

const disabledBtnStyle: React.CSSProperties = {
	...baseBtnStyle,
	opacity: 0.35,
	cursor: 'not-allowed',
};

const activeBtnStyle: React.CSSProperties = {
	...baseBtnStyle,
	background: 'var(--og-pagination-active-bg, #6d28d9)',
	borderColor: 'var(--og-pagination-active-bg, #6d28d9)',
	color: 'var(--og-pagination-active-color, #fff)',
	fontWeight: 600,
};

/**
 * A fully styleable pagination control. Works with both client and server grids.
 *
 * For client grids, use with `useClientGridPagination`. For server grids, manage
 * `page` state yourself and drive your datasource accordingly.
 *
 * Theming via CSS custom properties:
 *   `--og-pagination-border`, `--og-pagination-bg`, `--og-pagination-color`,
 *   `--og-pagination-active-bg`, `--og-pagination-active-color`
 *
 * @example Basic usage
 * <GridPagination page={page} pageCount={pageCount} onPageChange={setPage} />
 *
 * @example Custom styled
 * <GridPagination
 *   page={page}
 *   pageCount={pageCount}
 *   onPageChange={setPage}
 *   className="my-pagination"
 *   renderPrevButton={() => <ChevronLeft size={14} />}
 *   renderNextButton={() => <ChevronRight size={14} />}
 * />
 */
export function GridPagination({
	page,
	pageCount,
	onPageChange,
	totalRows,
	pageSize,
	canNextPage = page < pageCount - 1,
	canPrevPage = page > 0,
	className,
	style,
	maxPageButtons = 7,
	renderPrevButton,
	renderNextButton,
	renderPageInfo,
}: GridPaginationProps) {
	const pageNumbers = getPageNumbers(page, pageCount, maxPageButtons);

	const containerStyle = style ? { ...baseContainerStyle, ...style } : baseContainerStyle;

	return (
		<div className={`og-pagination${className ? ` ${className}` : ''}`} style={containerStyle} role='navigation' aria-label='Pagination'>
			<button
				style={canPrevPage ? baseBtnStyle : disabledBtnStyle}
				disabled={!canPrevPage}
				onClick={() => onPageChange(page - 1)}
				aria-label='Previous page'
			>
				{renderPrevButton ? renderPrevButton(!canPrevPage) : '‹'}
			</button>

			{pageNumbers.map((p) => {
				if (p === 'ellipsis-start' || p === 'ellipsis-end') {
					return (
						<span key={p} style={{ padding: '0 4px', fontSize: '13px', opacity: 0.5 }} aria-hidden>
							…
						</span>
					);
				}
				const isActive = p === page;
				return (
					<button
						key={p}
						style={isActive ? activeBtnStyle : baseBtnStyle}
						onClick={() => onPageChange(p)}
						aria-current={isActive ? 'page' : undefined}
						aria-label={`Page ${p + 1}`}
					>
						{p + 1}
					</button>
				);
			})}

			<button
				style={canNextPage ? baseBtnStyle : disabledBtnStyle}
				disabled={!canNextPage}
				onClick={() => onPageChange(page + 1)}
				aria-label='Next page'
			>
				{renderNextButton ? renderNextButton(!canNextPage) : '›'}
			</button>

			{renderPageInfo ? (
				renderPageInfo(page, pageCount, totalRows)
			) : (
				<span style={{ marginLeft: '8px', fontSize: '12px', opacity: 0.65 }}>
					{totalRows !== undefined && pageSize !== undefined
						? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, totalRows)} of ${totalRows}`
						: `Page ${page + 1} of ${pageCount}`}
				</span>
			)}
		</div>
	);
}
