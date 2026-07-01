import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { GridApi } from './types.js';

export interface FormulaBarProps<TRowData = unknown> {
	api: GridApi<TRowData>;
	className?: string;
	style?: React.CSSProperties;
}

const FxIcon = () => (
	<svg width='14' height='14' viewBox='0 0 14 14' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
		<path d='M2 3h3.5L8 10.5 10.5 3H14' />
		<path d='M1 7h5' />
	</svg>
);

/**
 * Formula bar that shows and edits the formula or raw value of the focused cell.
 * When the cell contains a formula (value starting with `=`), the formula string
 * is displayed rather than the evaluated result.
 *
 * Commit: Enter or Tab. Cancel: Escape. Clicking outside commits the current value.
 */
export function FormulaBar<TRowData = unknown>({ api, className, style }: FormulaBarProps<TRowData>) {
	const theme = api.getTheme();
	const [localValue, setLocalValue] = useState('');
	const [isEditing, setIsEditing] = useState(false);
	const [focusCell, setFocusCell] = useState<{ rowId: string; colField: string } | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	// Subscribe to selection changes to update displayed value.
	useEffect(() => {
		const unsubscribe = api.subscribeToKey('selection', () => {
			const state = api.getStateSnapshot();
			const focus = state.selection.focus;
			setFocusCell(focus ? { rowId: focus.rowId, colField: focus.colField } : null);
		});
		// Also subscribe broadly to catch cell value changes (e.g. live data).
		const unsubscribeGlobal = api.subscribe(() => {
			if (!isEditing) {
				const state = api.getStateSnapshot();
				const focus = state.selection.focus;
				if (focus) {
					const formula = api.getFormula(focus.rowId, focus.colField);
					setLocalValue(formula !== undefined ? formula : String(api.getCellValue(focus.rowId, focus.colField) ?? ''));
				}
			}
		});
		return () => {
			unsubscribe();
			unsubscribeGlobal();
		};
	}, [api, isEditing]);

	// Sync localValue when focus cell changes.
	useEffect(() => {
		if (isEditing) return;
		if (!focusCell) {
			setLocalValue('');
			return;
		}
		const formula = api.getFormula(focusCell.rowId, focusCell.colField);
		setLocalValue(formula !== undefined ? formula : String(api.getCellValue(focusCell.rowId, focusCell.colField) ?? ''));
	}, [api, focusCell, isEditing]);

	const commit = useCallback(() => {
		if (!isEditing || !focusCell) return;
		setIsEditing(false);
		if (localValue.startsWith('=')) {
			try {
				api.setFormula(focusCell.rowId, focusCell.colField, localValue);
			} catch {
				// Circular reference — revert to original
				const formula = api.getFormula(focusCell.rowId, focusCell.colField);
				setLocalValue(formula !== undefined ? formula : String(api.getCellValue(focusCell.rowId, focusCell.colField) ?? ''));
			}
		} else {
			api.setCellValue(focusCell.rowId, focusCell.colField, localValue);
		}
		inputRef.current?.blur();
	}, [api, focusCell, isEditing, localValue]);

	const cancel = useCallback(() => {
		if (!isEditing || !focusCell) return;
		setIsEditing(false);
		const formula = api.getFormula(focusCell.rowId, focusCell.colField);
		setLocalValue(formula !== undefined ? formula : String(api.getCellValue(focusCell.rowId, focusCell.colField) ?? ''));
		inputRef.current?.blur();
	}, [api, focusCell, isEditing]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (e.key === 'Enter' || e.key === 'Tab') {
				e.preventDefault();
				commit();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				cancel();
			}
		},
		[commit, cancel]
	);

	const isEmpty = !focusCell;

	return (
		<div
			className={className}
			style={{
				display: 'flex',
				alignItems: 'center',
				height: 32,
				background: theme.headerBg,
				borderBottom: `1px solid ${theme.borderColor}`,
				...style,
			}}
		>
			{/* Fx label */}
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					width: 36,
					height: '100%',
					borderRight: `1px solid ${theme.borderColor}`,
					color: isEditing ? theme.focusRing : theme.textColor,
					opacity: 0.7,
					flexShrink: 0,
					transition: 'color 0.1s',
				}}
			>
				<FxIcon />
			</div>

			{/* Cell address badge */}
			{focusCell && (
				<div
					style={{
						padding: '0 8px',
						fontSize: 11,
						fontFamily: 'ui-monospace, monospace',
						color: theme.textColor,
						opacity: 0.5,
						borderRight: `1px solid ${theme.borderColor}`,
						height: '100%',
						display: 'flex',
						alignItems: 'center',
						minWidth: 80,
						flexShrink: 0,
					}}
				>
					{focusCell.rowId}:{focusCell.colField}
				</div>
			)}

			{/* Formula / value input */}
			<input
				ref={inputRef}
				type='text'
				value={localValue}
				disabled={isEmpty}
				onChange={(e) => {
					setLocalValue(e.target.value);
					if (!isEditing) setIsEditing(true);
				}}
				onFocus={() => {
					if (focusCell) setIsEditing(true);
				}}
				onBlur={() => {
					// Commit on blur (click outside)
					if (isEditing) commit();
				}}
				onKeyDown={handleKeyDown}
				placeholder={isEmpty ? 'Select a cell' : ''}
				style={{
					flex: 1,
					height: '100%',
					border: 'none',
					outline: 'none',
					background: 'transparent',
					color: theme.textColor,
					fontSize: 13,
					fontFamily: localValue.startsWith('=') ? 'ui-monospace, monospace' : 'inherit',
					padding: '0 10px',
					cursor: isEmpty ? 'default' : 'text',
				}}
			/>

			{/* Editing indicator */}
			{isEditing && (
				<div
					style={{
						position: 'absolute',
						bottom: 0,
						left: 36,
						right: 0,
						height: 2,
						background: theme.focusRing,
						pointerEvents: 'none',
					}}
				/>
			)}
		</div>
	);
}
