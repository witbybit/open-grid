import React, { useState, useMemo } from 'react';
import { Grid, type GridReadyEvent } from '@open-grid/react';
import { Palette, Sparkles, Terminal, ShieldAlert, Code, Copy, Check } from 'lucide-react';
import { createSkinsColumns, generatePerformanceRows } from './demoGridConfigs';

interface HeadlessSkinsPlaygroundProps {
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	onCellValueChanged: (rowId: string, colField: string, val: unknown) => void;
	onGridReady?: (event: GridReadyEvent<any>) => void;
}

type SkinTheme = 'cyberpunk' | 'glassmorphic' | 'obsidian' | 'retro' | 'slate';

export default function HeadlessSkinsPlayground({
	editTrigger,
	arrowKeyNavigationEdit,
	onCellValueChanged,
	onGridReady,
}: HeadlessSkinsPlaygroundProps) {
	const [activeTheme, setActiveTheme] = useState<SkinTheme>('slate');
	const [copied, setCopied] = useState(false);
	const rows = useMemo(() => generatePerformanceRows(1000), []);
	const columns = useMemo(() => createSkinsColumns(), []);

	const themesInfo = {
		slate: {
			title: 'Enterprise Slate Grey',
			description:
				'Professional high-contrast obsidian base, sleek slate-grey headers, bold indigo accents, and vibrant emerald focus indicator highlights.',
			class: 'skins-slate',
		},
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

	// Generate exact CSS snippet shown in live code panel
	const cssSnippet = useMemo(() => {
		switch (activeTheme) {
			case 'slate':
				return `/* 1. ENTERPRISE SLATE GREY THEME */
.skins-slate .og-grid-container {
  background-color: #0f172a !important; /* slate-900 */
  border: 1px solid #334155 !important;
  font-family: 'Outfit', sans-serif !important;
}
.skins-slate .og-header-cell {
  background: #1e293b !important;
  color: #f8fafc !important;
  font-weight: 700 !important;
  border-bottom: 2px solid #6366f1 !important; /* Indigo */
  border-right: 1px solid #334155 !important;
  font-size: 11px !important;
}
.skins-slate .og-cell {
  background: #0f172a !important;
  color: #e2e8f0 !important;
  border-right: 1px solid #1e293b !important;
  border-bottom: 1px solid #1e293b !important;
}
.skins-slate .og-cell-focused,
.skins-slate .og-selection-border {
  border: 2px dashed #10b981 !important; /* Emerald */
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.4) !important;
  background: rgba(16, 185, 129, 0.05) !important;
}`;
			case 'cyberpunk':
				return `/* 2. CYBERPUNK NEON GLOW THEME */
.skins-cyberpunk .og-grid-container {
  background-color: #0b071e !important;
  border: 1px solid #ff007f33 !important;
  font-family: 'Fira Code', monospace !important;
}
.skins-cyberpunk .og-header-cell {
  background: #120b33 !important;
  color: #00ffff !important;
  font-weight: bold !important;
  border-bottom: 2px solid #00ffff !important;
  border-right: 1px solid #ff007f22 !important;
}
.skins-cyberpunk .og-cell {
  background: #0f0a2a88 !important;
  color: #ff007f !important;
  border-right: 1px solid #ff007f15 !important;
  border-bottom: 1px solid #ff007f15 !important;
}
.skins-cyberpunk .og-cell-focused,
.skins-cyberpunk .og-selection-border {
  border: 2px dashed #00ffff !important;
  box-shadow: 0 0 10px #00ffff88 !important;
}`;
			case 'glassmorphic':
				return `/* 3. ETHEREAL GLASSMORPHISM THEME */
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
}
.skins-glassmorphic .og-cell {
  background: rgba(255, 255, 255, 0.01) !important;
  color: rgba(241, 245, 249, 0.8) !important;
}
.skins-glassmorphic .og-cell-focused,
.skins-glassmorphic .og-selection-border {
  border: 2px dashed rgba(255, 255, 255, 0.6) !important;
}`;
			case 'obsidian':
				return `/* 4. OBSIDIAN & GOLD LUXE THEME */
.skins-obsidian .og-grid-container {
  background-color: #0d0c0f !important;
  border: 1px solid #fbbf2433 !important;
}
.skins-obsidian .og-header-cell {
  background: #17151c !important;
  color: #fbbf24 !important;
  border-bottom: 1px solid #fbbf2455 !important;
}
.skins-obsidian .og-cell {
  background: #0f0e12 !important;
  color: #e2e8f0 !important;
}
.skins-obsidian .og-cell-focused,
.skins-obsidian .og-selection-border {
  border: 2px dashed #fbbf24 !important;
  box-shadow: 0 0 8px #fbbf2444 !important;
}`;
			case 'retro':
				return `/* 5. PHOSPHOR CRT TERMINAL THEME */
.skins-retro .og-grid-container {
  background-color: #000000 !important;
  border: 2px solid #22c55e !important;
  font-family: 'Courier New', monospace !important;
}
.skins-retro .og-header-cell {
  background: #051a08 !important;
  color: #22c55e !important;
  border-bottom: 2px solid #22c55e !important;
}
.skins-retro .og-cell {
  background: #000000 !important;
  color: #4ade80 !important;
  text-shadow: 0 0 3px rgba(34, 197, 94, 0.6) !important;
}
.skins-retro .og-cell-focused,
.skins-retro .og-selection-border {
  border: 2px dashed #22c55e !important;
  box-shadow: 0 0 10px rgba(34, 197, 94, 0.8) !important;
}`;
			default:
				return '';
		}
	}, [activeTheme]);

	const handleCopyCode = () => {
		navigator.clipboard.writeText(cssSnippet);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden'>
			{/* Scoped CSS Injector */}
			<style>{`
				/* 1. ENTERPRISE SLATE GREY */
				.skins-slate .og-grid-container {
					background-color: #0f172a !important;
					border: 1px solid #334155 !important;
					font-family: 'Outfit', sans-serif !important;
				}
				.skins-slate .og-header-cell {
					background: #1e293b !important;
					color: #f8fafc !important;
					font-weight: 700 !important;
					border-bottom: 2px solid #6366f1 !important;
					border-right: 1px solid #334155 !important;
					font-size: 11px !important;
				}
				.skins-slate .og-cell {
					background: #0f172a !important;
					color: #e2e8f0 !important;
					border-right: 1px solid #1e293b !important;
					border-bottom: 1px solid #1e293b !important;
					font-size: 11px !important;
				}
				.skins-slate .og-cell-focused,
				.skins-slate .og-selection-border {
					border: 2px dashed #10b981 !important;
					box-shadow: 0 0 10px rgba(16, 185, 129, 0.4), inset 0 0 5px rgba(16, 185, 129, 0.2) !important;
					background: rgba(16, 185, 129, 0.05) !important;
				}

				/* 2. CYBERPUNK NEON */
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

				/* 3. ETHEREAL GLASSMORPHISM */
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

				/* 4. OBSIDIAN LUXE */
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

				/* 5. RETRO PHOSPHOR GREEN */
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

			{/* Left Column: Theme View & Controls */}
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
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
							<p className='text-[10px] text-slate-400 mt-0.5 leading-tight max-w-md'>{themesInfo[activeTheme].description}</p>
						</div>
					</div>

					{/* Selection Buttons */}
					<div className='z-10 flex flex-wrap gap-2 shrink-0 bg-slate-950 p-1 rounded-xl border border-slate-850'>
						{(Object.keys(themesInfo) as SkinTheme[]).map((theme) => (
							<button
								key={theme}
								onClick={() => setActiveTheme(theme)}
								className={`px-2.5 py-1.5 rounded-lg text-[9px] font-extrabold uppercase transition-all flex items-center gap-1 cursor-pointer ${
									activeTheme === theme
										? 'bg-purple-600 text-white shadow-lg shadow-purple-600/20 border border-purple-500/20'
										: 'text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-850 border border-slate-800'
								}`}
							>
								{theme === 'slate' && <Sparkles className='w-3 h-3 text-indigo-400' />}
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

					<Grid
						mode='client'
						rows={rows}
						columns={columns}
						getRowId={(row) => row.id}
						pinLeftColumns={1}
						pinRightColumns={1}
						onCellValueChanged={onCellValueChanged}
						editTrigger={editTrigger}
						arrowKeyNavigationEdit={arrowKeyNavigationEdit}
						className='!border-0 !rounded-none !bg-transparent !shadow-none'
						onGridReady={onGridReady}
					/>
				</div>

				{/* Headless architectural annotation footer */}
				<div className='p-3 bg-slate-900/10 border border-slate-900 rounded-xl flex items-start gap-2.5 shrink-0'>
					<ShieldAlert className='w-4 h-4 text-purple-400 mt-0.5 shrink-0' />
					<p className='text-[9px] text-slate-400 leading-normal font-medium'>
						<strong>Headless Architecture:</strong> None of these styles are hardcoded into the layout engine. By providing clean,
						predictable DOM naming conventions, styling is completely decoupled and easily managed via custom themes.
					</p>
				</div>
			</div>

			{/* Right Column: CSS Theme Code Studio Sidebar */}
			<div className='w-full xl:w-80 flex flex-col gap-4 shrink-0 overflow-y-auto max-h-full xl:max-h-none pr-1.5'>
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden h-full min-h-0'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-purple-600/5 rounded-full blur-2xl pointer-events-none' />

					<div className='flex justify-between items-center shrink-0'>
						<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
							<Code className='w-4 h-4 text-purple-400' />
							CSS Theme Customizer
						</h3>
						<button
							onClick={handleCopyCode}
							className='p-1.5 rounded-lg bg-slate-950 border border-slate-850 hover:border-slate-750 text-slate-400 hover:text-white transition-all duration-200'
							title='Copy CSS Styles'
						>
							{copied ? <Check className='w-3.5 h-3.5 text-emerald-400' /> : <Copy className='w-3.5 h-3.5' />}
						</button>
					</div>

					<div className='flex-1 flex flex-col bg-slate-950 border border-slate-900 rounded-lg p-3 min-h-[350px] overflow-hidden relative'>
						<div className='absolute right-2 top-2 text-[8px] font-mono text-slate-600 uppercase font-extrabold tracking-widest select-none'>
							CSS SNIPPET
						</div>
						<pre className='text-[9px] font-mono text-purple-400 leading-relaxed overflow-auto h-full pr-1 font-semibold select-text'>
							{cssSnippet}
						</pre>
					</div>

					<p className='text-[9px] text-slate-500 leading-relaxed font-medium mt-1 shrink-0'>
						Copy this generated theme and drop it directly into your global stylesheet. The semantic classes map instantly to your grid
						viewport.
					</p>
				</div>
			</div>
		</div>
	);
}
