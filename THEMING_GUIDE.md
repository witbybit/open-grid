# Open Grid CSS Theming System

Complete guide to the advanced theming system in Open Grid. Build advanced CSS styling/theming natively with support for light/dark modes, custom themes, and runtime switching.

## Overview

Open Grid provides a **modern, shadcn-style theming system** with:

- ✅ Built-in light & dark themes
- ✅ High-contrast accessibility themes
- ✅ Pre-built branded themes (Cool Blue, Warm Orange, Minimal Monochrome)
- ✅ Runtime theme switching with zero configuration
- ✅ System color scheme detection (prefers-color-scheme)
- ✅ Custom theme creation
- ✅ Partial theme merging
- ✅ Event-based theme change notifications
- ✅ CSS-variable based (no JS-in-CSS overhead)

## Quick Start

### 1. Using Built-In Themes

The grid defaults to the dark theme. To switch themes:

```typescript
import { createClientGrid } from '@open-grid/core';

const api = createClientGrid(config);

// Via GridHost interface (recommended)
host.switchTheme('light'); // Switch to light theme
host.switchTheme('dark-hc'); // Switch to high-contrast dark
host.switchTheme('cool-blue'); // Modern tech aesthetic

// Or get the theme manager directly
const themeManager = host.setTheme?.toString(); // Access via host methods
```

### 2. Using ThemeManager Directly

```typescript
import { ThemeManager, DARK_THEME } from '@open-grid/core';

const manager = new ThemeManager(DARK_THEME);
manager.mount(); // Inject theme into document

// Switch themes
manager.switchTheme('light');
manager.switchTheme('cool-blue');

// Get current theme
const theme = manager.getTheme();

// Subscribe to changes
const unsubscribe = manager.onThemeChange((theme) => {
	console.log('Theme changed:', theme);
});

// Cleanup
manager.unmount();
unsubscribe();
```

### 3. Creating Custom Themes

```typescript
import { createTheme, ThemeManager } from '@open-grid/core';

// Simple override approach
const myTheme = createTheme({
	bgColor: '#1a1a2e',
	textColor: '#eaeaea',
	focusRing: '#00d4ff',
	headerBg: '#0f0f1e',
	headerText: '#b0b0b0',
});

const manager = new ThemeManager(myTheme);
manager.mount();
```

### 4. System Color Scheme Detection

Automatically sync with OS dark/light mode preferences:

```typescript
import { ThemeManager } from '@open-grid/core';

// Create a manager that syncs with system preference
const manager = ThemeManager.createSystemAware();
manager.mount();

// Automatically switches to light/dark when system preference changes
```

## Built-In Themes

### Dark (Default)

High-contrast, professional dark theme optimized for extended viewing and reduced eye strain.

```typescript
import { DARK_THEME } from '@open-grid/core';
```

### Light

Clean, bright professional theme for daytime use.

```typescript
import { LIGHT_THEME } from '@open-grid/core';
```

### High-Contrast Light (`light-hc`)

Enhanced light theme with stronger contrasts for better accessibility.

```typescript
import { HIGH_CONTRAST_LIGHT_THEME } from '@open-grid/core';
```

### High-Contrast Dark (`dark-hc`)

Enhanced dark theme with stronger contrasts for better accessibility.

```typescript
import { HIGH_CONTRAST_DARK_THEME } from '@open-grid/core';
```

### Cool Blue (`cool-blue`)

Modern tech aesthetic with cool blue accent tones.

```typescript
import { COOL_BLUE_THEME } from '@open-grid/core';
```

### Warm Orange (`warm-orange`)

Energetic, warm aesthetic with orange accent tones.

```typescript
import { WARM_ORANGE_THEME } from '@open-grid/core';
```

### Minimal Monochrome (`minimal-monochrome`)

Ultra-clean, minimalist monochrome theme.

```typescript
import { MINIMAL_MONOCHROME_THEME } from '@open-grid/core';
```

## Theme Tokens

A complete theme defines **40+ CSS variables** organized by semantic purpose:

### Base Colors

- `bgColor` - Primary background
- `textColor` - Primary text
- `borderColor` - Standard border
- `borderColorAccent` - Emphasized border

### Header

- `headerBg` - Header background
- `headerText` - Header text color

### Interactive States

- `rowHoverBg` - Row hover state
- `cellBorder` - Cell border color
- `selectionBg` - Selection background
- `selectionBorder` - Selection border
- `focusRing` - Focus indicator (primary accent)

### Pinned Columns

- `pinLeftBorderColor` - Left pin border
- `pinRightBorderColor` - Right pin border
- `pinLeftShadow` - Left pin shadow
- `pinRightShadow` - Right pin shadow

### Loading States

- `skeletonStart` - Shimmer start color
- `skeletonMid` - Shimmer middle color
- `skeletonEnd` - Shimmer end color
- `skeletonWidth` - Skeleton element width
- `skeletonHeight` - Skeleton element height
- `skeletonBorderRadius` - Skeleton border radius
- `skeletonAnimationDuration` - Shimmer animation speed

### Group Rows

- `groupRowBg` - Group row background
- `groupRowHoverBg` - Group row hover background
- `groupRowText` - Group row text color
- `groupRowFontSize` - Group row font size
- `groupRowFontWeight` - Group row font weight
- `groupBadgeBg` - Count badge background
- `groupBadgeBorder` - Count badge border
- `groupBadgeText` - Count badge text color

### Detail Rows

- `detailRowBg` - Detail row background
- `detailRowBorder` - Detail row border
- `detailRowText` - Detail row text color
- `detailRowFontSize` - Detail row font size

### Popovers & Menus

- `popoverBg` - Popover background
- `popoverBorder` - Popover border
- `popoverText` - Popover text color
- `popoverItemHoverBg` - Menu item hover background
- `popoverItemActiveBg` - Menu item active background
- `popoverDivider` - Menu divider color
- `popoverInputBg` - Input/select background
- `popoverInputBorder` - Input/select border

### Sizing (Optional)

- `leafHeaderHeight` - Single header row height
- `groupPanelHeight` - Group panel height
- `bottomChromeHeight` - Status bar + pagination height
- `totalHeaderHeight` - Total header height (with grouping)

## Theming API

### ThemeTokens Interface

```typescript
interface ThemeTokens {
	fontFamily: string;
	bgColor: string;
	textColor: string;
	borderColor: string;
	borderColorAccent: string;
	headerBg: string;
	headerText: string;
	rowHoverBg: string;
	cellBorder: string;
	selectionBorder: string;
	selectionBg: string;
	focusRing: string;
	// ... 30+ more tokens
}
```

### ThemeManager API

```typescript
class ThemeManager {
	// Create and initialize
	constructor(initialTheme: ThemeTokens = DARK_THEME);
	mount(selector?: string): void;
	unmount(): void;

	// Get/Set themes
	getTheme(): ThemeTokens;
	setTheme(theme: ThemeTokens, selector?: string): void;
	switchTheme(themeName: BuiltInThemeName, selector?: string): void;
	mergeTheme(partial: Partial<ThemeTokens>, selector?: string): void;

	// Utilities
	getAvailableThemes(): BuiltInThemeName[];
	onThemeChange(listener: (theme: ThemeTokens) => void): () => void;

	// Static helpers
	static detectSystemPreference(): boolean;
	static createSystemAware(): ThemeManager;
}
```

### Helper Functions

```typescript
// Create a custom theme with partial overrides
function createTheme(overrides: Partial<ThemeTokens> = {}): ThemeTokens;

// Convert theme to CSS custom properties
function themeToCSSVariables(theme: ThemeTokens, selector?: string): string;

// Available theme names
type BuiltInThemeName = 'light' | 'dark' | 'light-hc' | 'dark-hc' | 'cool-blue' | 'warm-orange' | 'minimal-monochrome';

// Pre-built theme registry
const BUILT_IN_THEMES: Record<BuiltInThemeName, ThemeTokens>;
```

## Advanced Usage

### 1. Merging Themes

Modify specific tokens while keeping the rest:

```typescript
import { ThemeManager, DARK_THEME } from '@open-grid/core';

const manager = new ThemeManager(DARK_THEME);
manager.mount();

// Change just the accent color and selection background
manager.mergeTheme({
	focusRing: '#10b981', // Emerald instead of blue
	selectionBg: 'rgba(16, 185, 129, 0.1)',
	groupBadgeText: '#34d399',
});
```

### 2. Dynamic Theme Switching

```typescript
import { useCallback, useEffect, useState } from 'react';
import { createClientGrid } from '@open-grid/core';

function DynamicThemeExample() {
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('dark');

  const host = useRef(null);

  useEffect(() => {
    // Switch theme when mode changes
    host.current?.switchTheme(themeMode);
  }, [themeMode]);

  return (
    <div>
      <button onClick={() => setThemeMode('light')}>Light</button>
      <button onClick={() => setThemeMode('dark')}>Dark</button>
      {/* Grid container */}
    </div>
  );
}
```

### 3. System Preference Sync

```typescript
import { ThemeManager } from '@open-grid/core';

// Create manager that syncs with system dark mode preference
const manager = ThemeManager.createSystemAware();
manager.mount();

// Subscribe to changes (both explicit and system-driven)
manager.onThemeChange((theme) => {
	console.log('Theme updated:', theme.bgColor);
});
```

### 4. Custom Theme from Brand Guidelines

```typescript
import { createTheme, ThemeManager } from '@open-grid/core';

const brandTheme = createTheme({
	// Brand primary
	focusRing: '#6366f1', // Indigo

	// Light backgrounds
	bgColor: '#f8fafc',
	headerBg: '#f1f5f9',
	rowHoverBg: '#e2e8f0',

	// Typography
	textColor: '#1e293b',
	headerText: '#475569',

	// Interactive
	selectionBg: 'rgba(99, 102, 241, 0.08)',
	selectionBorder: 'rgba(99, 102, 241, 0.6)',

	// Popovers
	popoverBg: 'rgba(248, 250, 252, 0.98)',
	popoverItemHoverBg: 'rgba(99, 102, 241, 0.08)',
	popoverItemActiveBg: '#6366f1',
});

const manager = new ThemeManager(brandTheme);
manager.mount();
```

### 5. Exporting Theme Configuration

```typescript
import { themeToCSSVariables } from '@open-grid/core';

const theme = createTheme({...});
const cssText = themeToCSSVariables(theme);

// Output as a .css file, or embed in style tag
console.log(cssText);
// :root, .og-grid-container {
//   --og-bg-color: ...;
//   --og-text-color: ...;
//   ...
// }
```

## Integration with GridHost

The theme API is integrated into the GridHost interface for convenience:

```typescript
import { mountGridHost } from '@open-grid/core/internal';

const host = mountGridHost(api, container);

// Theme methods available directly on host
host.switchTheme('light');
host.setTheme(customTheme);
const theme = host.getTheme();

const unsubscribe = host.onThemeChange((theme) => {
	console.log('Theme changed');
});
```

## CSS Variable Customization

All theme variables are CSS custom properties, so you can override them directly on the container:

```html
<div id="grid" style="--og-bg-color: #1a1a2e; --og-focus-ring: #00d4ff;">
	<!-- Grid will render with custom colors -->
</div>
```

Or via stylesheets:

```css
.og-grid-container {
	--og-bg-color: #1a1a2e;
	--og-text-color: #eaeaea;
	--og-focus-ring: #00d4ff;
	/* ... override other tokens */
}
```

## CSS Theme Studio Demo

Open Grid includes an interactive CSS Theme Studio component to:

- Preview all built-in themes
- Inspect theme tokens live
- Export theme configuration code
- Test custom color combinations

```typescript
import { CSSThemeStudio } from './components/CSSThemeStudio';

function App() {
  return (
    <CSSThemeStudio
      onThemeSelect={(themeName, theme) => {
        gridHost.setTheme(theme);
      }}
    />
  );
}
```

## Performance Characteristics

- **Zero runtime overhead**: All theming via CSS custom properties (no JS calculations)
- **Instant switching**: Theme change = style element update (no re-render)
- **SSR-safe**: ThemeManager detects SSR and skips DOM operations
- **Memory efficient**: Single shared style element for all themes
- **No flash**: Default (dark) theme in CORE_STYLES prevents FOUC

## Best Practices

1. **Use semantic token names** when creating themes (e.g., `selectionBg` not `blue42`)
2. **Test with accessibility themes** (`light-hc`, `dark-hc`) for contrast
3. **Provide system preference option** via `ThemeManager.createSystemAware()`
4. **Persist theme choice** in localStorage for user preference
5. **Use partial merging** for small tweaks rather than full theme replacement
6. **Monitor color contrast** when creating custom themes
7. **Avoid hardcoding colors** in component styles; use CSS variables instead

## Troubleshooting

### Theme not applying?

1. Ensure `themeManager.mount()` is called after container is in the DOM
2. Check that selector matches your grid container class
3. Verify CSS specificity doesn't override `--og-*` variables

### Style flash on load?

The default dark theme is embedded in `CORE_STYLES` to prevent FOUC. If you prefer light theme by default, set it immediately after mount:

```typescript
manager.mount();
manager.switchTheme('light');
```

### Custom theme colors look wrong?

Ensure you're providing colors in the right format:

- Hex: `#3b82f6`
- RGB: `rgb(59, 130, 246)`
- RGBA: `rgba(59, 130, 246, 0.5)`
- CSS keywords: `transparent`, `inherit`

## Examples

See the CSS Theme Studio demo component (`demo/src/components/CSSThemeStudio.tsx`) for interactive examples of:

- Theme switching
- Token inspection
- Code export
- Live preview with all built-in themes

## Accessibility

Open Grid includes two high-contrast themes specifically designed for accessibility:

- **Light HC** (`light-hc`): Enhanced light theme with WCAG AA+ contrasts
- **Dark HC** (`dark-hc`): Enhanced dark theme with WCAG AA+ contrasts

Always test your custom themes against accessibility guidelines.

## Future Enhancements

Potential future additions to the theming system:

- [ ] Theme editor UI component
- [ ] Theme export/import (JSON)
- [ ] Local storage persistence adapter
- [ ] Runtime theme animation (smooth color transitions)
- [ ] Per-component theme overrides
- [ ] Theme preset library and marketplace
