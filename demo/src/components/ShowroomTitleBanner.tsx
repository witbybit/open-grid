import React from 'react';
import {
	Cpu,
	Database,
	FileSpreadsheet,
	Sliders,
	Layout,
	Paintbrush,
	TrendingUp,
	Play,
	PanelRightOpen,
	PanelRightClose,
} from 'lucide-react';
import { LatencyProfiler } from './GridShared';

interface ShowroomTitleBannerProps {
	activePage: 'perf' | 'server' | 'ranges' | 'editors' | 'layout' | 'skins' | 'dashboard';
	runBulkCalculationTest: () => void;
	applySpreadsheetRangeAction: (action: 'fill' | 'clear' | 'addPercent' | 'sum') => void;
	compactLayout: 'compact' | 'normal' | 'spacious';
	setCompactLayout: (layout: 'compact' | 'normal' | 'spacious') => void;
	rightSidebarCollapsed: boolean;
	setRightSidebarCollapsed: (collapsed: boolean) => void;
}

export default function ShowroomTitleBanner({
	activePage,
	runBulkCalculationTest,
	applySpreadsheetRangeAction,
	compactLayout,
	setCompactLayout,
	rightSidebarCollapsed,
	setRightSidebarCollapsed,
}: ShowroomTitleBannerProps) {
	return (
		<div className='flex items-center justify-between bg-slate-900/10 border border-slate-900 rounded-xl p-3.5 relative overflow-hidden shrink-0'>
			<div className='absolute right-0 top-0 translate-x-6 -translate-y-6 w-20 h-20 bg-purple-600/10 rounded-full blur-xl' />
			<div className='z-10 flex items-center gap-3'>
				<span className='p-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400'>
					{activePage === 'perf' && <Cpu className='w-4.5 h-4.5' />}
					{activePage === 'server' && <Database className='w-4.5 h-4.5' />}
					{activePage === 'ranges' && <FileSpreadsheet className='w-4.5 h-4.5' />}
					{activePage === 'editors' && <Sliders className='w-4.5 h-4.5' />}
					{activePage === 'layout' && <Layout className='w-4.5 h-4.5' />}
					{activePage === 'skins' && <Paintbrush className='w-4.5 h-4.5' />}
					{activePage === 'dashboard' && <TrendingUp className='w-4.5 h-4.5' />}
				</span>
				<div>
					<h2 className='text-sm font-extrabold text-slate-200 leading-tight uppercase tracking-wider flex items-center gap-2'>
						{activePage === 'perf' && 'Performance Calculations Playground'}
						{activePage === 'server' && 'Remote Infinite Scroll Engine'}
						{activePage === 'ranges' && 'Spreadsheet Multi-Range Workspace'}
						{activePage === 'editors' && 'Advanced Custom Editors & Renderers'}
						{activePage === 'layout' && 'Dynamic Layout Visibility & Resizing'}
						{activePage === 'skins' && 'Headless Skins & Themes Playground'}
						{activePage === 'dashboard' && 'Real-time Event-Driven Analytics Dashboard'}
					</h2>
					<p className='text-[10px] text-slate-400 leading-tight mt-0.5'>
						{activePage === 'perf' &&
							'Run high-speed reactive calculations on a 10,000-row list. Proof that sibling components bypass evaluations.'}
						{activePage === 'server' &&
							'Dynamically query a 100,000-row remote server with chunked pagination. Scroll down to trigger loaders.'}
						{activePage === 'ranges' &&
							'Perform advanced batch actions like addition and sum Tooltips over click-and-drag grid selection bounds.'}
						{activePage === 'editors' &&
							'Click interactive Gold star ratings and drag the double-click progress range slider to test premium cell components.'}
						{activePage === 'layout' &&
							'Toggle column checkboxes and normal/compact spacing buttons to see live grid layouts render under sub-millisecond loads.'}
						{activePage === 'skins' &&
							'Toggle between preset aesthetic styles to verify extreme grid layout design flexibility.'}
						{activePage === 'dashboard' &&
							'View real-time stock portfolio metrics, live updated sparklines, and selection value aggregates.'}
					</p>
				</div>
			</div>

			{/* Context-aware upper toolbar buttons */}
			<div className='z-10 flex gap-2 shrink-0'>
				{activePage === 'perf' && (
					<button
						onClick={runBulkCalculationTest}
						className='flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-purple-600 hover:bg-purple-700 font-bold text-[10px] text-white border border-purple-500/20 shadow-md shadow-purple-600/10 transition-all font-sans'
					>
						<Play className='w-3 h-3' />
						Simulate 1,000 Live Updates
					</button>
				)}

				{activePage === 'ranges' && (
					<div className='flex gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-850 shrink-0'>
						<button
							onClick={() => applySpreadsheetRangeAction('sum')}
							className='px-2.5 py-1 rounded text-[10px] bg-slate-900 border border-slate-800 text-purple-400 font-bold hover:text-white transition-all font-sans'
						>
							Sum Selected
						</button>
						<button
							onClick={() => applySpreadsheetRangeAction('addPercent')}
							className='px-2.5 py-1 rounded text-[10px] bg-slate-900 border border-slate-800 text-indigo-400 font-bold hover:text-white transition-all font-sans'
						>
							Add +10%
						</button>
						<button
							onClick={() => applySpreadsheetRangeAction('fill')}
							className='px-2.5 py-1 rounded text-[10px] bg-slate-900 border border-slate-800 text-emerald-400 font-bold hover:text-white transition-all font-sans'
						>
							Fill 100
						</button>
						<button
							onClick={() => applySpreadsheetRangeAction('clear')}
							className='px-2.5 py-1 rounded text-[10px] bg-slate-900 border border-slate-800 text-rose-400 font-bold hover:text-white transition-all font-sans'
						>
							Clear Range
						</button>
					</div>
				)}

				{activePage === 'layout' && (
					<div className='flex items-center gap-1.5 bg-slate-950 border border-slate-850 rounded-lg p-0.5 shrink-0'>
						{(['compact', 'normal', 'spacious'] as const).map((mode) => (
							<button
								key={mode}
								onClick={() => {
									const start = performance.now();
									setCompactLayout(mode);
									const duration = performance.now() - start;
									LatencyProfiler.record(duration);
								}}
								className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase transition-all ${
									compactLayout === mode ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
								}`}
							>
								{mode}
							</button>
						))}
					</div>
				)}

				<button
					onClick={() => setRightSidebarCollapsed(!rightSidebarCollapsed)}
					className='flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-slate-950 hover:bg-slate-900 font-bold text-[10px] text-slate-300 hover:text-white border border-slate-850 hover:border-slate-750 transition-all font-sans'
					title={rightSidebarCollapsed ? 'Open Controls Sidebar' : 'Hide Controls Sidebar'}
				>
					{rightSidebarCollapsed ? <PanelRightOpen className='w-3 h-3' /> : <PanelRightClose className='w-3 h-3' />}
					{!rightSidebarCollapsed ? 'Hide Controls' : 'Show Controls'}
				</button>
			</div>
		</div>
	);
}
