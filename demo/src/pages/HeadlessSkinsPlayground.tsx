import React, { useState, useMemo, useRef } from 'react';
import { Grid, type GridReadyEvent } from '@open-grid/react';
import { Palette } from 'lucide-react';
import { createSkinsColumns, generatePerformanceRows } from './demoGridConfigs';
import { CSSThemeStudio } from '../components/CSSThemeStudio';

interface HeadlessSkinsPlaygroundProps {
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
	onGridReady?: (event: GridReadyEvent<any>) => void;
}

/**
 * Headless Skins Playground - API-Driven Theme Studio
 *
 * Demonstrates the new theme system using:
 * - CSSThemeStudio component for theme selection and preview
 * - GridApi theme methods (switchTheme, onThemeChange)
 * - No hardcoded CSS, fully CSS-variable driven
 * - Clean separation: UI controls theme, theme controls DOM styles
 */
export default function HeadlessSkinsPlayground({
	editTrigger,
	arrowKeyNavigationEdit,
	onCellValueChanged,
	onGridReady,
}: HeadlessSkinsPlaygroundProps) {
	const [activeTheme, setActiveTheme] = useState<'light' | 'dark' | 'cool-blue'>('dark');
	const apiRef = useRef<any>(null);
	const rows = useMemo(() => generatePerformanceRows(1000, 'R'), []);
	const columns = useMemo(() => createSkinsColumns(), []);

	const handleThemeSelect = (themeName: string) => {
		setActiveTheme(themeName as any);
		// Use the API facade to switch theme
		// The theme name is passed through the API boundary, no direct core import needed
		if (apiRef.current?.switchTheme) {
			apiRef.current.switchTheme(themeName);
		}
	};

	const handleGridReady = (event: GridReadyEvent<any>) => {
		apiRef.current = event.api;
		onGridReady?.(event);
	};

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden'>
			{/* Left Column: Theme Studio + Grid View */}
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				{/* CSS Theme Studio Header */}
				<div className='bg-slate-900/10 border border-slate-900 rounded-xl p-4 flex items-center gap-3 shrink-0'>
					<span className='p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400'>
						<Palette className='w-4.5 h-4.5' />
					</span>
					<div>
						<h3 className='text-sm font-extrabold text-slate-200 uppercase tracking-wider'>Advanced CSS Theming System</h3>
						<p className='text-[10px] text-slate-400 mt-0.5 leading-tight'>
							API-driven themes with runtime switching and CSS-variable architecture
						</p>
					</div>
				</div>

				{/* Themed Grid Viewport */}
				<div className='flex-1 min-h-0 relative rounded-xl overflow-hidden border border-slate-800'>
					<Grid
						mode='client'
						rows={rows}
						columns={columns}
						getRowId={(row) => row.id}
						pinLeftColumns={1}
						pinRightColumns={1}
						navigationOptions={{
							editTrigger,
							arrowKeyNavigationEdit,
							onCellValueChanged,
						}}
						onGridReady={handleGridReady}
					/>
				</div>

				{/* Architecture Info */}
				<div className='p-3 bg-slate-900/10 border border-slate-900 rounded-xl flex items-start gap-2.5 shrink-0'>
					<div className='text-purple-400 mt-0.5 shrink-0'>ℹ️</div>
					<p className='text-[9px] text-slate-400 leading-normal font-medium'>
						<strong>API-Driven Theming:</strong> Theme control flows through GridApi.switchTheme(). No direct core imports in the demo.
						Theme changes trigger CSS-variable updates via ThemeManager, keeping DOM manipulation minimal and styles fully decoupled from
						structure.
					</p>
				</div>
			</div>

			{/* Right Column: CSS Theme Studio Sidebar */}
			<div className='w-full xl:w-96 flex flex-col gap-4 shrink-0 overflow-y-auto max-h-full xl:max-h-none pr-1.5'>
				<CSSThemeStudio onThemeSelect={handleThemeSelect} />
			</div>
		</div>
	);
}
