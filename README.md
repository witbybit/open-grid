# 🚀 Headless High-Performance Data Grid & Spreadsheet Engine

Open Grid is a lightweight, framework-agnostic headless grid engine for high-performance virtualized spreadsheets. The core keeps rendering optional, centralizes state in `GridEngine`, and uses targeted subscriptions so React adapters can update individual cells without forcing global grid re-renders.

---

## ⚡ Technical Architecture Overview

To bypass the React virtual DOM rendering bottleneck (which slows down standard grids), the core operates on an **out-of-render state loop** driven by an object-oriented **Row Node Tree**:

```mermaid
graph TD
    A[GridApi] --> B[RowNode Tree]
    B --> C[Viewport Range Calculator]
    C --> D[Visible Row Nodes slice]

    A --> E[Keyboard Navigation]
    A --> F[Dynamic Formulas & Accessors]

    A --> G[Framework Adapters]
    G --> H[@open-grid/react bindings]

    H --> I[Isolated Cell-Level Subscribers]
    I --> J[Targeted Cell Paint]
```

### Core Architecture Highlights

1. **Stateful RowNode Tree**: Decouples raw record arrays from layout metadata like vertical coordinates, selected/expanded states, and explicit heights.
2. **Cellular Value Cache**: Prevents redundant `valueGetter` calculations or path split operations on scrolling by caching cell computations directly on individual `RowNode` structures.
3. **Pre-Compiled Path Getters**: Compiles column accessors into optimized functional selectors upon schema registration, eliminating runtime string manipulations and garbage collection pressures.
4. **Targeted Micro-Subscriptions**: Cell components subscribe to their specific coordinate keys. Value edits notify the edited cell, formula dependents, and dynamic same-row value getter cells.
5. **Dynamic Listener Garbage Collection**: Subscription listeners are active only for elements currently in the scroll viewport. Scrolling elements out of the viewport automatically unmounts them, dereferencing their subscriptions to prevent memory leaks.
6. **Small Programmatic API (`GridApi`)**: Exposes obvious row, cell, selection, sort, and filter operations while keeping stores, render scheduling, and plugin internals behind the adapter boundary.

---

## 🔥 Key Developer Features

Open Grid comes equipped with an extensive suite of built-in features designed for advanced spreadsheet development:

- **High-Performance Virtualization**: Virtualizes both rows and columns dynamically, yielding standard 60 FPS performance even for massive datasets with 100k+ rows and 1,000+ columns.
- **Sticky Lanes (Pinning)**: Sticky pinning for left/right columns and top/bottom rows with floating headers and scroll boundaries.
- **Excel-like Selections & Drag-to-Fill**: Features interactive multi-range cell selection and a dynamic Excel-like purple dashed border drag-to-fill handle with real-time selection telemetry (Sum, Count, Average).
- **Scoped Formulas**: Optional spreadsheet-style formulas using `[rowId:columnField]` references, arithmetic operators, and `SUM`, `AVERAGE`, `MIN`, and `MAX`, with dependency invalidation and cached lazy evaluation.
- **Command History (Undo / Redo)**: Seamless core state journaling enabling unlimited undo/redo capability across cell mutations and updates.
- **Flexible Row Models**: In-memory `ClientRowModel` (ideal for instant manipulation) vs. asynchronous chunk-paginated `ServerRowModel` with built-in loading shimmer/skeleton state trackers.
- **Dynamic Custom CSS Styling Slots**: Custom styling hooks (`rowClass`, `cellClass`, `headerCellClass`) that allow granular styling control on cell-by-cell or row-by-row bases.
- **Premium Glassmorphism Context Menu**: A customizable, visually stunning context menu plugin offering instant spreadsheet control desks.

---

## 🚀 Getting Started

### 1. Installation

Install dependencies from the root directory using `pnpm`:

```bash
pnpm install
```

### 2. Basic Setup Example

Here is how to quickly spin up a basic virtualized grid using React:

```tsx
import React, { useMemo } from 'react';
import { GridProvider, OpenGrid, useClientGrid, type ColumnDef } from '@open-grid/react';

// 1. Define your data structure
interface BookRow {
	id: string;
	title: string;
	author: string;
	price: number;
}

export default function BookInventoryGrid() {
	// 2. Set up column definitions
	const columns = useMemo<ColumnDef<BookRow>[]>(
		() => [
			{ field: 'id', header: 'Asset ID', width: 100 },
			{ field: 'title', header: 'Book Title', width: 250 },
			{ field: 'author', header: 'Author', width: 180 },
			{
				field: 'price',
				header: 'Price',
				width: 120,
				valueGetter: ({ row }) => `$${row.price.toFixed(2)}`,
			},
		],
		[]
	);

	// 3. Define initial row records
	const initialRows = useMemo<BookRow[]>(
		() => [
			{ id: 'B-101', title: 'The Pragmatic Programmer', author: 'Andy Hunt', price: 49.99 },
			{ id: 'B-102', title: 'Clean Code', author: 'Robert C. Martin', price: 42.5 },
			{ id: 'B-103', title: 'Designing Data-Intensive Applications', author: 'Martin Kleppmann', price: 54.95 },
		],
		[]
	);

	// 4. Create the public GridApi handle
	const api = useClientGrid<BookRow>({
		rows: initialRows,
		columns,
		getRowId: (row) => row.id,
		initialState: {
			defaultColWidth: 120,
			defaultRowHeight: 38,
		},
	});

	// 5. Wrap your component in a GridProvider and render the OpenGrid component
	return (
		<div style={{ width: '100%', height: '500px' }}>
			<GridProvider api={api}>
				<OpenGrid
					pinLeftColumns={1} // Keep ID column sticky
					enableNavigation={true} // Enable keyboard movement
				/>
			</GridProvider>
		</div>
	);
}
```

---

## 🛠️ Public API Reference (`GridApi`)

Application code works through the standard `GridApi` interface. In React, this handle can be retrieved inside custom components or in your component tree using `useGridApi()`.

### Core API Methods

| Method                 | Type Signature                                              | Description                                                       |
| :--------------------- | :---------------------------------------------------------- | :---------------------------------------------------------------- |
| **`getState`**         | `() => GridState`                                           | Retrieves the entire synchronous state snapshot.                  |
| **`getCellValue`**     | `(rowId: string, colField: string) => unknown`              | Retrieves the calculated cell value from the value cache.         |
| **`setCellValue`**     | `(rowId: string, colField: string, value: unknown) => void` | Mutates a cell value, registering a new history event.            |
| **`getCellState`**     | `(rowId: string, colField: string) => CellState`            | Retrieves the local value, computed value, and active edit state. |
| **`selectCell`**       | `(pointer: GridCellPointer \| null) => void`                | Sets active cell focus and triggers `focusChanged` event.         |
| **`selectRange`**      | `(start: Pointer \| null, end: Pointer \| null) => void`    | Highlights a selection range bounding box.                        |
| **`setColumnWidth`**   | `(colField: string, width: number) => void`                 | Dynamically resizes a column's layout boundary.                   |
| **`subscribeToKey`**   | `(key: string, listener: Listener) => () => void`           | Micro-subscribes selectively to a single key coordinate.          |
| **`addEventListener`** | `(type: string, cb: GridEventListener) => () => void`       | Registers grid-wide action hooks (e.g. `cellValueChanged`).       |
| **`undo` / `redo`**    | `() => void`                                                | Moves backward or forward through undoable grid edits.            |

---

## 💡 Real-world API Examples

### 1. Multi-Cell Edits

Use ordinary API calls for multiple cell edits. The engine batches cell invalidation and repaint internally:

```typescript
const api = useGridApi();

api.setCellValue('S-1001', 'revenue', '150000');
api.setCellValue('S-1001', 'opex', '80000');
api.selectCell({ rowId: 'S-1001', colField: 'revenue' });
```

### 2. State-Driven Custom Styles (`styleSlots`)

Provide standard callback predicates to apply tailored conditional classes:

```tsx
const api = useClientGrid<ProductRow>({
	rows,
	columns,
	initialState: {
		styleSlots: {
			rowClass: (row) => {
				return row.status === 'Inactive' ? 'bg-slate-900/50 opacity-60' : '';
			},
			cellClass: (col, row) => {
				if (col.field === 'price' && Number(row.price) > 500) {
					return 'text-rose-400 font-extrabold text-glow-rose bg-rose-950/10';
				}
				return '';
			},
		},
	},
});
```

### 3. Highly Granular Cell-Level Pub-Sub Subscriptions

To listen to a specific cell value update without causing sibling cells to re-render:

```typescript
const api = useGridApi();

// Subscribes strictly to coordinate changes for S-1002 in column 'A'
const unsub = api.subscribeToKey('cell:value:S-1002:A', (state) => {
	const latestValue = api.getCellValue('S-1002', 'A');
	console.log('Instant cell update received:', latestValue);
});

// Call when dismantling listeners
unsub();
```

---

## 🎨 Creating Custom Cell Renderers & Editors

Open Grid allows you to build completely customized interactive input editors and renderers by implementing simple React component adapters.

### 1. Custom Cell Renderer (Interactive Star Ratings)

Renderers are used for gorgeous visual presentation:

```tsx
import React from 'react';
import type { CellRendererProps } from '@open-grid/react';

export const StarRatingRenderer = ({ value, rowId, colField, api }: CellRendererProps<ProductRow>) => {
	const rating = Number(value) || 0;

	const handleStarClick = (starIndex: number, e: React.MouseEvent) => {
		e.stopPropagation();
		e.preventDefault();

		// Mutate the cell store directly upon user clicks
		api.setCellValue(rowId, colField, starIndex.toString());
	};

	return (
		<div className='flex items-center gap-1 select-none cursor-pointer'>
			{[1, 2, 3, 4, 5].map((star) => (
				<button key={star} onClick={(e) => handleStarClick(star, e)}>
					<svg
						className={`w-4 h-4 ${star <= rating ? 'text-amber-400 fill-amber-400' : 'text-slate-650'}`}
						xmlns='http://www.w3.org/2000/svg'
						viewBox='0 0 24 24'
						fill='currentColor'
					>
						<path d='M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z' />
					</svg>
				</button>
			))}
		</div>
	);
};
```

### 2. Custom Cell Editor (Operational Status Dropdown)

Editors handle active cell text-entry or dropdown events, offering hooks to commit or cancel edits:

```tsx
import React from 'react';
import type { CellEditorProps } from '@open-grid/react';

export const StatusDropdownEditor = ({ value, onCommit, onCancel }: CellEditorProps<ProductRow>) => {
	return (
		<select
			autoFocus
			value={value as string}
			onChange={(e) => onCommit(e.target.value)} // Commit value and close edit mode
			onMouseDown={(e) => e.stopPropagation()} // Prevent focus shifting
			onDoubleClick={(e) => e.stopPropagation()}
			onKeyDown={(e) => {
				if (e.key === 'Escape') onCancel(); // Cancel editing
			}}
			className='absolute inset-0 w-full h-full px-3 text-xs bg-slate-900 text-white border-2 border-purple-500 outline-none z-20 font-semibold cursor-pointer'
		>
			<option value='Active'>Active</option>
			<option value='Pending'>Pending</option>
			<option value='Inactive'>Inactive</option>
		</select>
	);
};
```

---

## 📊 Spreadsheet Formulas & Calculations

Open Grid supports scoped formulas as an optional spreadsheet behavior. You can pass formula expressions starting with `=` as cell values, and the engine invalidates affected computed cells when source cells change.

### Writing Formulas

Formula strings specify cell references using `[rowId:columnField]` coordinate targets:

```typescript
// S-1001:C is calculated reactively as Revenue minus OpEx
api.setCellValue('S-1001', 'C', '=SUM([S-1001:A],-[S-1001:B])');

// S-1001:F scales the computed value of S-1001:C dynamically
api.setCellValue('S-1001', 'F', '=[S-1001:C]*0.8');
```

Whenever `S-1001:A` or `S-1001:B` changes, the calculated output for `C` and `F` is invalidated and recalculated lazily on access.

Formula support is intentionally narrow: it handles explicit `[rowId:columnField]` references, numeric arithmetic, parentheses, string fallback values, and `SUM`, `AVERAGE`, `MIN`, and `MAX`. It does not currently implement A1 notation, cross-sheet references, ranges like `A1:A10`, date functions, lookup functions, or Excel-compatible coercion semantics.

---

## 🛠️ Scripts & Local Developer Guides

### 1. Running Unit Tests

Open Grid uses Vitest for core correctness tests around formulas, row models, invalidation, and virtualization geometry. The performance tests exercise engine hot paths in Node/jsdom; use browser profiling for real paint, layout, and compositor measurements.

```bash
pnpm run test
```

### 2. Compiling Packages

Compile TypeScript files in watch or production bundle configurations:

```bash
pnpm run build
```

### 3. Launching Vite Showroom Dashboard

Start the high-fidelity showroom application:

```bash
pnpm dev:demo
```

Open your browser to `http://localhost:5173` to explore Calculations Arena (heavy simulation playground), Spreadsheet Workspace (ranges, formulas, and series drag handles), and Infinite Server Scroll (lazy loaded database server chunks).

---

## 👑 Author & Creator

**Rishikesh Kumar**  
Lead Architect of Open Grid
