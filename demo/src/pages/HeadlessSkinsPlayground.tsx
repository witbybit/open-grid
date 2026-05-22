import React, { useState } from 'react';
import { GridStore, ClientRowModelController } from '@open-grid/core';
import { GridProvider } from '@open-grid/react';
import { PerformanceRow, GridView } from '../components/GridShared';
import { Palette, Sparkles, Terminal, ShieldAlert } from 'lucide-react';

interface HeadlessSkinsPlaygroundProps {
	store: GridStore<PerformanceRow>;
	controller: ClientRowModelController<PerformanceRow>;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
}

type SkinTheme = 'cyberpunk' | 'glassmorphic' | 'obsidian' | 'retro';

export default function HeadlessSkinsPlayground({
	store,
	controller,
	editTrigger,
	arrowKeyNavigationEdit,
	onCellValueChanged,
}: HeadlessSkinsPlaygroundProps) {
	const [activeTheme, setActiveTheme] = useState<SkinTheme>('cyberpunk');

	const themesInfo = {
		cyberpunk: {
			title: 'Cyberpunk Neon Glow',
			description: 'Vibrant hot pink selection lines, neon cyan headers, and a dark synthetic violet backdrop with matrix elements.',
			class: 'skins-cyberpunk',
		},
		glassmorphic: {
			title: 'Ethereal Glassmorphism',
			description: 'Translucent frosted cells, deep backdrop blur, and soft magenta/violet floating background gradients.',
			class: 'skins-glassmorphic',
		},
		obsidian: {
			title: 'Obsidian & Gold Luxe',
			description: 'Sophisticated deep obsidian-black slate with hairline gold-leaf cell highlights and high-contrast amber fonts.',
			class: 'skins-obsidian',
		},
		retro: {
			title: 'Phosphor Green Terminal',
			description: 'Nostalgic IBM 3270 CRT terminal look with bright green glowing text, scanline overlays, and pure Courier code fonts.',
			class: 'skins-retro',
		},
	};

	return (
		<div className='flex flex-col h-full w-full gap-4'>
			{/* Scoped CSS Injector */}
			<style>{`
				/* 1. CYBERPUNK NEON */
				.skins-cyberpunk .og-grid-container {
					background-color: #0b071e !important;
					border: 1px solid #ff007f33 !important;
					font-family: 'Fira Code', 'Courier New', monospace !important;
				}
				.skins-cyberpunk .og-header-cell {
					background: #120b33 !important;
					color: #00ffff !important;
					font-weight: bold !important;
					border-bottom: 2px solid #00ffff !important;
					border-right: 1px solid #ff007f22 !important;
					text-transform: uppercase !important;
					font-size: 10px !important;
					letter-spacing: 0.05em !important;
				}
				.skins-cyberpunk .og-cell {
					background: #0f0a2a88 !important;
					color: #ff007f !important;
					border-right: 1px solid #ff007f15 !important;
					border-bottom: 1px solid #ff007f15 !important;
					font-size: 11px !important;
				}
				.skins-cyberpunk .og-cell-focused,
				.skins-cyberpunk .og-selection-border {
					border: 2px dashed #00ffff !important;
					box-shadow: 0 0 10px #00ffff88, inset 0 0 5px #00ffff44 !important;
					background: rgba(0, 255, 255, 0.05) !important;
				}

				/* 2. ETHEREAL GLASSMORPHISM */
				.skins-glassmorphic .og-grid-container {
					background: rgba(15, 23, 42, 0.25) !important;
					backdrop-filter: blur(12px) !important;
					-webkit-backdrop-filter: blur(12px) !important;
					border: 1px solid rgba(255, 255, 255, 0.1) !important;
				}
				.skins-glassmorphic .og-header-cell {
					background: rgba(255, 255, 255, 0.06) !important;
					color: rgba(255, 255, 255, 0.9) !important;
					border-bottom: 1px solid rgba(255, 255, 255, 0.15) !important;
					border-right: 1px solid rgba(255, 255, 255, 0.08) !important;
					font-size: 11px !important;
				}
				.skins-glassmorphic .og-cell {
					background: rgba(255, 255, 255, 0.01) !important;
					color: rgba(241, 245, 249, 0.8) !important;
					border-right: 1px solid rgba(255, 255, 255, 0.04) !important;
					border-bottom: 1px solid rgba(255, 255, 255, 0.04) !important;
					font-size: 11px !important;
				}
				.skins-glassmorphic .og-cell-focused,
				.skins-glassmorphic .og-selection-border {
					border: 2px dashed rgba(255, 255, 255, 0.6) !important;
					box-shadow: 0 0 15px rgba(255, 255, 255, 0.15) !important;
					background: rgba(255, 255, 255, 0.05) !important;
				}

				/* 3. OBSIDIAN LUXE */
				.skins-obsidian .og-grid-container {
					background-color: #0d0c0f !important;
					border: 1px solid #fbbf2433 !important;
				}
				.skins-obsidian .og-header-cell {
					background: #17151c !important;
					color: #fbbf24 !important;
					font-weight: 800 !important;
					border-bottom: 1px solid #fbbf2455 !important;
					border-right: 1px solid #2d2a33 !important;
					font-size: 10px !important;
					letter-spacing: 0.1em !important;
					text-transform: uppercase !important;
				}
				.skins-obsidian .og-cell {
					background: #0f0e12 !important;
					color: #e2e8f0 !important;
					border-right: 1px solid #1c1a22 !important;
					border-bottom: 1px solid #1c1a22 !important;
					font-size: 11px !important;
				}
				.skins-obsidian .og-cell-focused,
				.skins-obsidian .og-selection-border {
					border: 2px dashed #fbbf24 !important;
					box-shadow: 0 0 8px #fbbf2444 !important;
					background: rgba(251, 191, 36, 0.03) !important;
				}

				/* 4. RETRO PHOSPHOR GREEN */
				.skins-retro .og-grid-container {
					background-color: #000000 !important;
					border: 2px solid #22c55e !important;
					font-family: 'Courier New', monospace !important;
				}
				.skins-retro .og-header-cell {
					background: #051a08 !important;
					color: #22c55e !important;
					font-weight: bold !important;
					border-bottom: 2px solid #22c55e !important;
					border-right: 1px solid #22c55e33 !important;
					font-size: 11px !important;
				}
				.skins-retro .og-cell {
					background: #000000 !important;
					color: #4ade80 !important;
					border-right: 1px solid #22c55e22 !important;
					border-bottom: 1px solid #22c55e22 !important;
					font-size: 12px !important;
					text-shadow: 0 0 3px rgba(34, 197, 94, 0.6) !important;
				}
				.skins-retro .og-cell-focused,
				.skins-retro .og-selection-border {
					border: 2px dashed #22c55e !important;
					box-shadow: 0 0 10px rgba(34, 197, 94, 0.8) !important;
					background: rgba(34, 197, 94, 0.08) !important;
				}
			`}</style>

			{/* Custom Theme Selector Bar */}
			<div className='bg-slate-900/10 border border-slate-900 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shrink-0 relative overflow-hidden'>
				<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-28 h-28 bg-purple-600/5 rounded-full blur-2xl pointer-events-none' />
				<div className='z-10 flex items-center gap-3'>
					<span className='p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400'>
						<Palette className='w-4.5 h-4.5 animate-bounce' />
					</span>
					<div>
						<h3 className='text-sm font-extrabold text-slate-200 uppercase tracking-wider flex items-center gap-2'>
							{themesInfo[activeTheme].title}
						</h3>
						<p className='text-[10px] text-slate-400 mt-0.5 leading-tight max-w-xl'>
							{themesInfo[activeTheme].description}
						</p>
					</div>
				</div>

				{/* Selection Buttons */}
				<div className='z-10 flex flex-wrap gap-2 shrink-0 bg-slate-950 p-1 rounded-xl border border-slate-850'>
					{(Object.keys(themesInfo) as SkinTheme[]).map((theme) => (
						<button
							key={theme}
							onClick={() => setActiveTheme(theme)}
							className={`px-3 py-1.5 rounded-lg text-[10px] font-extrabold uppercase transition-all flex items-center gap-1.5 cursor-pointer ${
								activeTheme === theme
									? 'bg-purple-600 text-white shadow-lg shadow-purple-600/20 border border-purple-500/20'
									: 'text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-850 border border-slate-800'
							}`}
						>
							{theme === 'cyberpunk' && <Sparkles className='w-3 h-3 text-pink-400' />}
							{theme === 'glassmorphic' && <Sparkles className='w-3 h-3 text-purple-300' />}
							{theme === 'obsidian' && <Sparkles className='w-3 h-3 text-yellow-500' />}
							{theme === 'retro' && <Terminal className='w-3 h-3 text-emerald-400' />}
							{theme}
						</button>
					))}
				</div>
			</div>

			{/* Themed Viewport Area */}
			<div className={`flex-1 min-h-0 relative ${themesInfo[activeTheme].class} rounded-xl overflow-hidden`}>
				{activeTheme === 'glassmorphic' && (
					<>
						{/* Ambient flowing gradients behind glass container */}
						<div className='absolute -left-12 -top-12 w-48 h-48 rounded-full bg-pink-500/20 blur-3xl pointer-events-none animate-pulse' />
						<div className='absolute -right-12 -bottom-12 w-64 h-64 rounded-full bg-purple-500/20 blur-3xl pointer-events-none animate-pulse' />
					</>
				)}

				{activeTheme === 'retro' && (
					/* CRT scanline simulation layer */
					<div className='absolute inset-0 w-full h-full pointer-events-none z-30 bg-scanlines opacity-10 border border-emerald-950/20' />
				)}

				<GridProvider store={store}>
					<GridView
						store={store}
						pinLeftColumns={1}
						pinRightColumns={1}
						onCellValueChanged={onCellValueChanged}
						clientController={controller}
						editTrigger={editTrigger}
						arrowKeyNavigationEdit={arrowKeyNavigationEdit}
						className='!border-0 !rounded-none !bg-transparent !shadow-none'
					/>
				</GridProvider>
			</div>

			{/* Headless architectural annotation footer */}
			<div className='p-3 bg-slate-900/10 border border-slate-900 rounded-xl flex items-start gap-2.5 shrink-0'>
				<ShieldAlert className='w-4 h-4 text-purple-400 mt-0.5 shrink-0' />
				<p className='text-[9px] text-slate-400 leading-normal font-medium'>
					<strong>Headless Proof of Concept:</strong> None of the styling above is hardcoded inside the core rendering loop or 
					virtualization layout managers. Because OpenGrid provides pure, clean semantic DOM containers with predictable namespaces, 
					styling can be entirely governed by external css stylesheets. The grid engine doesn't dictate themes — you do.
				</p>
			</div>
		</div>
	);
}
