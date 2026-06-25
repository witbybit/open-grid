import React, { useEffect, useState } from 'react';
import type { GridApi } from '@open-grid/react';
import { TableProperties, Terminal } from 'lucide-react';

export const StateInspector = React.memo(({ api }: { api: GridApi<any> }) => {
	const [selectedCount, setSelectedCount] = useState(() => api.selection.getState().selectedRowIds.size);
	const [anchorId, setAnchorId] = useState<string | null>(() => {
		const s = api.selection.getState();
		return s.anchorRowId != null ? String(s.anchorRowId) : null;
	});

	useEffect(() => {
		const sync = () => {
			const s = api.selection.getState();
			setSelectedCount(s.selectedRowIds.size);
			setAnchorId(s.anchorRowId != null ? String(s.anchorRowId) : null);
		};
		sync();
		return api.subscribe((event) => {
			if (event.type === 'selection.changed') sync();
		});
	}, [api]);

	return (
		<div className='flex shrink-0 flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4 glass-card'>
			<h3 className='flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400'>
				<TableProperties className='h-4 w-4 text-purple-400' />
				State Inspector
			</h3>
			<div className='break-all rounded-lg border border-slate-850 bg-slate-950 p-2.5 font-mono text-xs leading-relaxed text-purple-400'>
				Selected rows: {selectedCount} <br />
				Anchor ID: {anchorId ?? 'None'}
			</div>
			<p className='text-[9px] leading-normal text-slate-500'>
				* This panel reads the active API supplied by the page. It does not create another grid owner.
			</p>
		</div>
	);
});

StateInspector.displayName = 'StateInspector';

export const LiveEventLogPanel = React.memo(({ api }: { api: GridApi<any> }) => {
	const [eventLogs, setEventLogs] = useState<string[]>([]);

	useEffect(() => {
		setEventLogs([]);
		const addLog = (msg: string) => setEventLogs((prev) => [msg, ...prev].slice(0, 4));

		return api.subscribe((event) => {
			switch (event.type) {
				case 'cells.changed':
					addLog(`cellValueChanged => ${JSON.stringify(event.payload)}`);
					break;
				case 'columns.changed':
					addLog(`columnChanged => ${JSON.stringify(event.payload)}`);
					break;
				case 'selection.changed':
					addLog(`selectionChanged => ${JSON.stringify(event.payload)}`);
					break;
				case 'pipeline.changed':
					addLog(`pipelineChanged => ${JSON.stringify(event.payload)}`);
					break;
				default:
					break;
			}
		});
	}, [api]);

	return (
		<div className='flex shrink-0 flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4 glass-card'>
			<h3 className='flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400'>
				<Terminal className='h-4 w-4 text-purple-400' />
				Reactive Store Log
			</h3>
			<div className='flex max-h-40 flex-col gap-2 overflow-y-auto'>
				{eventLogs.length === 0 ? (
					<div className='rounded-lg border border-slate-900 bg-slate-950/60 p-2 font-mono text-[10px] italic text-slate-600'>
						Emitting real-time state logs...
					</div>
				) : (
					eventLogs.map((log, index) => (
						<div
							key={`${index}-${log}`}
							className='break-all rounded-lg border border-slate-850 bg-slate-950 p-2 font-mono text-[9px] leading-snug text-purple-400'
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
