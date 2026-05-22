import React from 'react';
import {
	Cpu,
	Database,
	FileSpreadsheet,
	Sliders,
	Layout,
	Paintbrush,
	TrendingUp,
	PanelLeftClose,
	PanelLeftOpen,
	Sparkles,
} from 'lucide-react';

interface ShowroomLeftSidebarProps {
	activePage: 'perf' | 'server' | 'ranges' | 'editors' | 'layout' | 'skins' | 'dashboard';
	leftSidebarCollapsed: boolean;
	setLeftSidebarCollapsed: (collapsed: boolean) => void;
}

export default function ShowroomLeftSidebar({
	activePage,
	leftSidebarCollapsed,
	setLeftSidebarCollapsed,
}: ShowroomLeftSidebarProps) {
	const navItems = [
		{
			id: 'perf',
			label: 'Calculations Arena',
			subtitle: '10k Rows • Real-time Math',
			icon: Cpu,
		},
		{
			id: 'server',
			label: 'Infinite Scroll',
			subtitle: '100k Rows • Delayed Chunks',
			icon: Database,
		},
		{
			id: 'ranges',
			label: 'Spreadsheet Selection',
			subtitle: 'Multi-Range • Batch Math',
			icon: FileSpreadsheet,
		},
		{
			id: 'editors',
			label: 'Custom Editors',
			subtitle: 'Ratings • Progress Slider',
			icon: Sliders,
		},
		{
			id: 'layout',
			label: 'Dynamic Visibility',
			subtitle: 'Hide Columns • Compact Row',
			icon: Layout,
		},
		{
			id: 'skins',
			label: 'Skins Playground',
			subtitle: 'Preset Themes & CSS Skins',
			icon: Paintbrush,
		},
		{
			id: 'dashboard',
			label: 'Analytics Dashboard',
			subtitle: 'Real-time Portfolio Stats',
			icon: TrendingUp,
		},
	] as const;

	return (
		<div
			className={`${leftSidebarCollapsed ? 'w-16 p-2' : 'w-56 p-4'} shrink-0 flex flex-col justify-between overflow-y-auto glass-panel rounded-xl border border-slate-900/50 relative transition-all duration-300 ease-in-out`}
		>
			<div className='flex flex-col gap-5'>
				<div className={`flex items-center justify-between ${leftSidebarCollapsed ? 'flex-col gap-3' : ''} px-1.5 py-0.5`}>
					{!leftSidebarCollapsed && (
						<span className='text-[9px] font-bold text-slate-500 uppercase tracking-wider truncate'>Showrooms</span>
					)}
					<button
						onClick={() => setLeftSidebarCollapsed(!leftSidebarCollapsed)}
						className='p-1 rounded-lg hover:bg-slate-800/60 text-slate-400 hover:text-white transition-all duration-200 shadow-sm border border-slate-800/30'
						title={leftSidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
					>
						{leftSidebarCollapsed ? <PanelLeftOpen className='w-4 h-4' /> : <PanelLeftClose className='w-4 h-4' />}
					</button>
				</div>

				<nav className='flex flex-col gap-1.5'>
					{navItems.map((item) => {
						const Icon = item.icon;
						const isActive = activePage === item.id;
						return (
							<a
								key={item.id}
								href={`#${item.id}`}
								title={leftSidebarCollapsed ? `${item.label} (${item.subtitle})` : undefined}
								className={`w-full flex ${leftSidebarCollapsed ? 'justify-center p-3' : 'flex-col gap-0.5 px-3 py-2.5'} rounded-xl text-left transition-all group ${
									isActive
										? 'bg-purple-600 text-white shadow-lg shadow-purple-600/10'
										: 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
								}`}
							>
								<div className='flex items-center gap-2 text-xs font-bold'>
									<Icon className='w-4 h-4 shrink-0' />
									{!leftSidebarCollapsed && item.label}
								</div>
								{!leftSidebarCollapsed && (
									<span className={`text-[9px] ${isActive ? 'text-purple-200' : 'text-slate-500'} font-medium`}>
										{item.subtitle}
									</span>
								)}
							</a>
						);
					})}
				</nav>
			</div>

			<div className='flex flex-col gap-3 pt-4 border-t border-slate-900/60 items-center justify-center'>
				{leftSidebarCollapsed ? (
					<div
						title='Grid Engine v3.1.0'
						className='p-2 rounded-lg bg-slate-950/40 border border-slate-900/80 text-purple-400 cursor-help'
					>
						<Sparkles className='w-4 h-4' />
					</div>
				) : (
					<div className='flex items-center justify-between w-full p-2 rounded-lg bg-slate-950/40 border border-slate-900/80'>
						<div className='flex items-center gap-1.5 text-[10px] text-slate-400 font-bold'>
							<Sparkles className='w-3 h-3 text-purple-400' />
							Grid Engine
						</div>
						<span className='font-mono text-[9px] text-slate-500 font-semibold'>v3.1.0</span>
					</div>
				)}
			</div>
		</div>
	);
}
