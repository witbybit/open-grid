# Headless High-Performance Data Grid & Spreadsheet Engine

A lightweight, unstyled, and modular headless grid engine built specifically for high-performance virtualized spreadsheets. By decoupling rendering from state management using a framework-agnostic core and targeted pub-sub subscriptions, the engine achieves sub-millisecond cell updates, handles **100,000+ rows at 60+ FPS**, and avoids global React re-renders.

---

## ⚡ Key Technical Architecture

To bypass the React virtual DOM rendering bottleneck (which slows down standard grids), the core operates on an **out-of-render state loop** driven by an object-oriented **Row Node Tree**:

```mermaid
graph TD
    A[GridStore / Pub-Sub Database] --> B[RowNode Tree]
    B --> C[Viewport Range Calculator]
    C --> D[Visible Row Nodes slice]

    A --> E[GridNavigationController / Keyboard State Machine]
    A --> F[Dynamic Formulas & Accessors]

    A --> G[Framework Adapters]
    G --> H[@open-grid/react bindings]

    H --> I[Isolated Cell-Level Subscribers]
    I --> J[O(1) Cell paint via targeted cell:value listener]
```

### Core Architecture Highlights

1. **Stateful RowNode Tree**: Decouples business record arrays from layout metadata (like vertical coordinates, selected/expanded states, and explicit heights). Allows grid operations to run at pure $O(1)$ complexity.
2. **Cellular Value Cache**: Prevents redundant `valueGetter` calculations or path split operations on scrolling by caching cell computations directly on individual `RowNode` structures.
3. **Pre-Compiled Path Getters**: Compiles column accessors into optimized functional selectors upon schema registration, eliminating runtime string manipulations and garbage collection pressures.
4. **Targeted Micro-Subscriptions**: Cell components subscribe strictly to their specific coordinate keys (e.g. `cell:value:${rowId}:${colField}`). Value edits trigger _only_ the affected cell component, keeping performance extremely clean.
5. **Dynamic Listener Garbage Collection**: Subscription listeners are active only for elements currently in the scroll viewport. Scrolling elements out of the viewport automatically unmounts them, dereferencing their subscriptions to prevent memory leaks.
6. **Unified Programmatic API (`GridApi`)**: Exposes an absolute control handle which is injected into custom components, headers, and editors to programmatically control coordinates, edit states, selections, and transactions.

---

## 📁 Monorepo Layout

```
/open-grid
  ├── package.json               # Root monorepo configuration
  ├── pnpm-workspace.yaml        # Monorepo workspace packages
  ├── tsconfig.json              # Base TypeScript configuration
  ├── packages/
  │   ├── core/
  │   │   ├── src/
  │   │   │   ├── store.ts       # Granular pub-sub GridStore & GridApi
  │   │   │   ├── rowModel.ts    # Stateful RowNode trees & indexing
  │   │   │   ├── navigation.ts  # Keyboard & mouse math listeners
  │   │   │   ├── serverRowModel.ts # Block paginator cache
  │   │   │   └── store.test.ts  # Vitest unit test suite
  │   │   └── tsconfig.json
  │   └── react/
  │       ├── src/
  │       │   └── index.tsx      # useSyncExternalStore connector hooks
  │       └── tsconfig.json
  └── apps/
      └── demo/
          ├── src/
          │   ├── App.tsx        # High-fidelity virtualized showroom playground
          │   └── index.css      # Glassmorphism panels & glow style setups
          ├── vite.config.ts
          └── tailwind.config.js
```

---

## 🎛️ Interactive Showroom Dashboard

The workspace demo has been expanded into an immersive 3-column playground demonstrating every dimension of the grid engine:

### 1. Dedicated Showroom Pages

- **Calculations Arena**: Simulates heavy database sheets with 10k rows. Mutating a cell triggers lightning-fast recalculations of derived columns in pure $O(1)$ updates.
- **Infinite Server Scroll**: Handles 100k rows via a paginated block lazy loader. Demonstrates simulated network lags, loading skeleton views, and server cache purging.
- **Spreadsheet Workspace**: 500 rows with multi-range cell selection, drag highlights, batch arithmetic adjustments (+10%, clear, fill), and real-time range aggregation (Sum/Average tooltip).
- **Custom Editors & Renderers**: Employs stars rating selectors, custom ranges/progress sliders, and badges within a high-performance grid viewport.
- **Dynamic Layout Panel**: Renders compact/normal/spacious layout selectors, column visibility toggles, and live drag-resizing.

### 2. Live Telemetry & Observability Deck

- **Grid Telemetry Hub**: Counts rows, columns, active virtual layout renderers, and total event listeners.
- **Render Flash Monitor**: Offers a "Flash Cells on Render" CSS-glow toggler to visually prove that updates remain localized to edited cells with zero sibling row re-renders.
- **Latency & Calculation Profiler**: Charts state transaction profiles in sub-millisecond durations.
- **Live Event Log Stream**: Terminal log console broadcasting grid events.

---

## 🛠️ Public Interfaces & APIs

### 1. `GridApi` State Mutation Methods

The central API handle is accessible anywhere in your component tree:

| Method                 | Type Signature                                                      | Description                                                                      |
| :--------------------- | :------------------------------------------------------------------ | :------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| **`getState`**         | `() => GridState`                                                   | Retrieves the entire synchronous state snapshot.                                 |
| **`setState`**         | `(updater: Partial<GridState>                                       | ((s: GridState) => Partial<GridState>)) => void`                                 | Updates specific keys in state, triggering selective listeners. |
| **`setCellValue`**     | `(rowId: string, colField: string, val: any) => void`               | Updates a cell value and dispatches `cellValueChanged` event.                    |
| **`stopEditing`**      | `(cancel?: boolean) => void`                                        | Commits or cancels the active cell edit transaction.                             |
| **`setFocusedCell`**   | `(rowId: string                                                     | null, colField: string                                                           | null) => void`                                                  | Focuses on a specific coordinate and dispatches `focusChanged` event. |
| **`setSelectedRange`** | `(start: { rowId: string; colField: string }                        | null, end: { rowId: string; colField: string }                                   | null) => void`                                                  | Highlights a range selection and dispatches `selectionChanged` event. |
| **`setColumnWidth`**   | `(colField: string, width: number) => void`                         | Resizes a column and dispatches `columnResized` event.                           |
| **`subscribeToKey`**   | `(key: string, listener: (state: GridState) => void) => () => void` | Subscribes selectively to a single key (e.g. `cell:value:${rowId}:${colField}`). |
| **`addEventListener`** | `(type: string, cb: GridEventListener) => () => void`               | Subscribes to core engine events (e.g. value changes, resize).                   |

---

## 🔌 Pluggable Event System

The core store broadcasts structured event payloads when functional shifts occur:

```typescript
const unsub = api.addEventListener('cellValueChanged', (event) => {
	const { rowId, colField, oldValue, newValue } = event.payload;
	console.log(`Cell at rowId ${rowId}, column ${colField} changed to ${newValue}`);
});

// Call unsub() to clean up listener bindings
unsub();
```

---

## 🎨 Custom Cell Editors & Renderers

Developing custom inputs is extremely easy. The grid core provides standard prop interfaces which include the fully-empowered `GridApi` to execute dynamic cross-cell calculations:

```typescript
import { CellEditorProps } from '@open-grid/react';

const StatusCellEditor = ({ rowId, colField, value, api }: CellEditorProps) => {
	return (
		<select
			autoFocus
			value={value}
			onChange={(e) => {
				const nextVal = e.target.value;

				// 1. Programmatically write status value to this cell
				api.setCellValue(rowId, colField, nextVal);

				// 2. Programmatically close editing mode using stopEditing API
				api.stopEditing(false);

				// 3. E2E GridApi Side-Effect: Set Price & Qty to 0 if status is Inactive
				if (nextVal === 'Inactive') {
					api.setCellValue(rowId, 'price', '0');
					api.setCellValue(rowId, 'quantity', '0');
				}
			}}
			className='absolute inset-0 bg-slate-900 text-white border border-purple-500'
		>
			<option value='Active'>Active</option>
			<option value='Inactive'>Inactive</option>
		</select>
	);
};
```

---

## 🚀 Scripts & Local Developer Guides

### 1. Dependencies & Installations

This monorepo utilizes `pnpm` workspace packages. Run the following command from the root of the directory to install all packages:

```bash
pnpm install
```

### 2. Development Operations

#### Run Vitest Unit Tests

```bash
pnpm run test
```

#### Compile TS Workspace Packages

```bash
pnpm run build
```

#### Launch Vite Dashboard Dev Server

```bash
pnpm dev:demo
```

Once active, navigate your browser to the local URL (default is `http://localhost:5173`) to test interactive resizes, formula evaluations, custom dropdown select editors, and core transaction logs in the event inspector!

---

## 👑 Author & Creator

**Rishikesh Kumar**  
Lead Architect of Grid Engine
