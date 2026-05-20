import React, { useState, useEffect } from 'react';
import { GridStore } from '@open-grid/core';
import { GridProvider, useGridKeySelector } from '@open-grid/react';
import { TableProperties, Terminal } from 'lucide-react';

// ============================================================================
// StateInspectorContent
// ============================================================================

const StateInspectorContent = () => {
	const focusedCell = useGridKeySelector('focusedCell', (state) => state.focusedCell);
	const selectedRange = useGridKeySelector('selectedRange', (state) => state.selectedRange);

	const focusText = focusedCell ? `Row ID: ${focusedCell.rowId}, Col Field: ${focusedCell.colField}` : 'None';
	const rangeText = selectedRange
		? `(${selectedRange.start.rowId},${selectedRange.start.colField}) to (${selectedRange.end.rowId},${selectedRange.end.colField})`
		: 'None';

	return (
		<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-2 shrink-0 glass-card'>
			<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
				<TableProperties className='w-4 h-4 text-purple-400' />
				State Inspector
			</h3>
			<div className='p-2.5 bg-slate-950 border border-slate-850 rounded-lg text-xs font-mono text-purple-400 leading-relaxed break-all'>
				Focused: {focusText} <br />
				Range: {rangeText}
			</div>
			<p className='text-slate-500 text-[9px] leading-normal'>
				* Cell coordinates are represented by persistent RowIDs rather than fluctuating coordinate arrays, ensuring sort-stable rendering!
			</p>
		</div>
	);
};

// ============================================================================
// StateInspector (Exported Wrapper to safely provide Provider context)
// ============================================================================

export const StateInspector = React.memo(({ store }: { store: GridStore<any> }) => {
	return (
		<GridProvider store={store}>
			<StateInspectorContent />
		</GridProvider>
	);
});

StateInspector.displayName = 'StateInspector';

// ============================================================================
// LiveEventLogPanel
// ============================================================================

interface LiveEventLogPanelProps {
	store: GridStore<any>;
}

export const LiveEventLogPanel = React.memo(({ store }: LiveEventLogPanelProps) => {
	const [eventLogs, setEventLogs] = useState<string[]>([]);

	useEffect(() => {
		setEventLogs([]);

		const formatLog = (name: string, payload: unknown) => {
			return `${name} => ${JSON.stringify(payload)}`;
		};

		const addLog = (msg: string) => {
			setEventLogs((prev) => [msg, ...prev].slice(0, 4));
		};

		const unsubValue = store.addEventListener('cellValueChanged', (e) => {
			addLog(formatLog('cellValueChanged', e.payload));
		});

		const unsubResize = store.addEventListener('columnResized', (e) => {
			addLog(formatLog('columnResized', e.payload));
		});

		const unsubFocus = store.addEventListener('focusChanged', (e) => {
			addLog(formatLog('focusChanged', e.payload));
		});

		const unsubSelect = store.addEventListener('selectionChanged', (e) => {
			addLog(formatLog('selectionChanged', e.payload));
		});

		const unsubSort = store.addEventListener('sortChanged', (e) => {
			addLog(formatLog('sortChanged', e.payload));
		});

		const unsubFilter = store.addEventListener('filterChanged', (e) => {
			addLog(formatLog('filterChanged', e.payload));
		});

		return () => {
			unsubValue();
			unsubResize();
			unsubFocus();
			unsubSelect();
			unsubSort();
			unsubFilter();
		};
	}, [store]);

	return (
		<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-3 shrink-0 glass-card'>
			<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
				<Terminal className='w-4 h-4 text-purple-400' />
				Reactive Store Log
			</h3>
			<div className='flex flex-col gap-2 max-h-40 overflow-y-auto'>
				{eventLogs.length === 0 ? (
					<div className='text-[10px] text-slate-600 italic font-mono p-2 bg-slate-950/60 border border-slate-900 rounded-lg'>
						Emitting real-time state logs...
					</div>
				) : (
					eventLogs.map((log, i) => (
						<div
							key={i}
							className='p-2 bg-slate-950 border border-slate-850 rounded-lg text-[9px] font-mono text-purple-400 leading-snug break-all'
						>
							{log}
						</div>
					))
				)}
			</div>
		</div>
	);
});

LiveEventLogPanel.displayName = 'LiveEventLogPanel';
