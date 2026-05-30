# 🚀 Headless High-Performance Data Grid & Spreadsheet Engine

Open Grid is a lightweight, framework-agnostic, headless grid engine for high-performance virtualized spreadsheets and data grids. Built to handle massive datasets with complex layouts, Open Grid maintains an out-of-render state loop in a centralized engine while exposing granular micro-subscriptions. This allows React, Vue, or vanilla JS wrappers to paint individual cells and rows with surgical precision, entirely bypassing the framework rendering bottleneck.

---

## ⚡ Technical Architecture Overview

To bypass virtual DOM performance bottlenecks and eliminate layout thrashing during rapid scrolling, Open Grid decouples raw record arrays from visual presentation using a dynamic **Row Node Tree** and a discriminated union **VisualRow** pipeline:

```mermaid
graph TD
    A[GridApi Facade] --> B[RowNode Tree]
    B --> C[RowPipeline stages]

    subgraph RowPipeline Stages [RowPipeline stages]
        C1[Client Sort & Filter] --> C2[groupStage / treeStage]
        C2 --> C3[sortTreeStage]
        C3 --> C4[aggregateStage]
        C4 --> C5[flattenStage]
    end

    C5 --> D[Viewport Recycler]
    D --> E[Visible Row Nodes slice]

    A --> F[Keyboard Navigation Engine]
    A --> G[Scoped Formula Solver]

    A --> H[Framework Adapters]
    H --> I[@open-grid/react bindings]

    I --> J[Isolated Cell-Level Subscribers]
    J --> K[Targeted Cell Repaint]
```

### Core Architecture Highlights

1. **Stateful RowNode Tree**: Separates raw data records from layout metadata (such as coordinate mappings, dynamic vertical offsets, selection flags, and expansion states).
2. **Discriminated VisualRow Model**: Rather than treating every row strictly as a data-centric `RowNode`, the layout engine outputs a flat, virtualized array of `VisualRow` nodes representing either data rows (`kind: 'data'`), grouping labels (`kind: 'group'`), or nested components (`kind: 'detail'`).
3. **Cellular Value Cache**: Prevents redundant `valueGetter` executions and runtime path-splitting operations by caching computed cell values directly on individual `RowNode` structures until data is modified.
4. **Pre-Compiled Path Getters**: Accessors (such as `user.profile.name`) are compiled into optimized, static functional selectors upon schema registration to avoid continuous garbage collection pressure.
5. **Targeted Micro-Subscriptions**: Cell components subscribe strictly to their coordinates (e.g., `cell:value:row-101:price`). Edits only repaint the exact target cell, formula dependents, and conditional formatting listeners.
6. **Active Viewport Subscription Garbage Collection**: Micro-subscriptions are bound dynamically. Scrolling cells out of the recycled DOM unmounts them, dereferencing their subscriptions to prevent memory leaks in long-running processes.

---

## 🔥 Key Developer Features

Open Grid comes equipped with an extensive suite of built-in features designed for advanced spreadsheet and data dashboard development:

- **High-Performance Virtualization**: Virtualizes both rows and columns dynamically, yielding standard 60 FPS performance even for massive datasets with 100,000+ rows and 1,000+ columns.
- **Sticky Lanes (Pinning)**: Floating stickiness for left/right columns and top/bottom rows with floating headers and scroll boundaries.
- **Excel-like Selections & Drag-to-Fill**: Features interactive multi-range cell selection, arrow keyboard navigation, and an Excel-like purple dashed border drag-to-fill handle with real-time selection telemetry (Sum, Count, Average).
- **Dynamic Multi-Level Row Grouping & Aggregations**: Group records recursively by column fields with automatic, bottom-up parent aggregate calculations (Sum, Average, Min, Max, Count, or custom reducers).
- **Hierarchical Tree Hierarchy**: Support parent-child tree data structures (e.g., file directories) with custom node renderers and dynamic visual indentation depths.
- **Interactive Master-Detail Layouts (Nested Grids)**: Render completely separate, fully interactive sub-grids inside parent detail portals, with live cross-grid state synchronization.
- **Advanced Header Filters & Custom Menus**: Register custom React header popovers for custom filtering, multi-sort, and column settings.
- **Scoped Formulas**: Optional spreadsheet-style formulas using `[rowId:columnField]` references, arithmetic operators, and functions with dependency invalidation.
- **Command History (Undo / Redo)**: Seamless state journaling enabling unlimited undo/redo capability across cell mutations and updates.

---

## 🚀 Getting Started

### 1. Installation

Install Open Grid packages in your monorepo or project.

```bash
pnpm install @open-grid/core @open-grid/react
```

### 2. Basic Setup Example

Here is how to quickly spin up a basic virtualized grid using React:

```tsx
import React, { useMemo } from 'react';
import { GridProvider, OpenGrid, useClientGrid, type ColumnDef } from '@open-grid/react';

interface BookRow {
	id: string;
	title: string;
	author: string;
	price: number;
}

export default function BookInventoryGrid() {
	// 1. Define your column definitions
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

	// 2. Define initial row records
	const initialRows = useMemo<BookRow[]>(
		() => [
			{ id: 'B-101', title: 'The Pragmatic Programmer', author: 'Andy Hunt', price: 49.99 },
			{ id: 'B-102', title: 'Clean Code', author: 'Robert C. Martin', price: 42.5 },
			{ id: 'B-103', title: 'Designing Data-Intensive Applications', author: 'Martin Kleppmann', price: 54.95 },
		],
		[]
	);

	// 3. Create the public GridApi handle
	const api = useClientGrid<BookRow>({
		rows: initialRows,
		columns,
		getRowId: (row) => row.id,
		initialState: {
			defaultColWidth: 120,
			defaultRowHeight: 38,
		},
	});

	// 4. Wrap your component in a GridProvider and render the OpenGrid component
	return (
		<div style={{ width: '100%', height: '500px' }}>
			<GridProvider api={api}>
				<OpenGrid
					pinLeftColumns={1} // Keep Asset ID column sticky
					enableNavigation={true} // Enable arrow key keyboard movement
				/>
			</GridProvider>
		</div>
	);
}
```

---

## 🛠️ Advanced Features & Guides

### 1. Row Grouping & Aggregations

Row grouping organizes rows into an expandable folder-like structure based on identical column values. Aggregations allow you to compute summary metrics dynamically for these parent groups.

#### Configuration

To enable row grouping, pass the `groupBy` fields inside the `initialState` configuration. Define aggregates using the pipeline `aggDefs`.

```tsx
import React, { useMemo, useCallback } from 'react';
import { OpenGrid, GridProvider, useClientGrid, type ColumnDef, type VisualRow, type GridApi } from '@open-grid/react';

interface EmployeeRow {
	id: string;
	name: string;
	department: string;
	salary: number;
}

export function GroupedEmployeesGrid({ data }: { data: EmployeeRow[] }) {
	const columns = useMemo<ColumnDef<EmployeeRow>[]>(
		() => [
			{ field: 'id', header: 'ID', width: 100 },
			{ field: 'name', header: 'Full Name', width: 180 },
			{ field: 'department', header: 'Department', width: 150 },
			{ field: 'salary', header: 'Salary', width: 120 },
		],
		[]
	);

	const api = useClientGrid<EmployeeRow>({
		rows: data,
		columns,
		initialState: {
			groupBy: ['department'], // Group on-the-fly by department
			groupRowHeight: 42,
		},
	});

	// Custom group row renderer to display summary aggregates
	const groupRowRenderer = useCallback(({ visualRow, api }: { visualRow: VisualRow<EmployeeRow>; api: GridApi<EmployeeRow> }) => {
		if (visualRow.kind !== 'group') return null;

		const expanded = visualRow.expanded;
		const handleToggle = (e: React.MouseEvent) => {
			e.stopPropagation();
			api.toggleGroupExpanded(visualRow.id);
		};

		return (
			<div
				className='flex items-center justify-between px-4 h-full bg-slate-900 border-b border-slate-800 cursor-pointer'
				onClick={handleToggle}
				style={{ paddingLeft: `${visualRow.depth * 20 + 10}px` }}
			>
				<div className='flex items-center gap-2'>
					<span>{expanded ? '▼' : '▶'}</span>
					<span className='font-bold text-xs text-purple-400'>{visualRow.field.toUpperCase()}:</span>
					<span className='text-white font-semibold text-xs'>{String(visualRow.key)}</span>
				</div>
				<span className='text-[10px] bg-purple-950 text-purple-300 border border-purple-800 px-2 py-0.5 rounded-full font-bold'>
					{visualRow.childCount} employees
				</span>
			</div>
		);
	}, []);

	return (
		<div style={{ height: '500px' }}>
			<GridProvider api={api}>
				<OpenGrid groupRowRenderer={groupRowRenderer} />
			</GridProvider>
		</div>
	);
}
```

---

### 2. Hierarchical Tree Data

Hierarchical trees organize rows into nested structures based on a parent-child relationship (ideal for file system directories, organizational charts, or bill of materials).

#### Configuration

To configure tree data, specify the `getParentId` function inside `initialState`. To indent the tree columns, inspect the current `VisualRow`'s `depth` within a custom cell renderer.

```tsx
import React, { useMemo } from 'react';
import { OpenGrid, GridProvider, useClientGrid, type ColumnDef, type CellRendererProps } from '@open-grid/react';

interface FileNode {
	id: string;
	name: string;
	parentId?: string;
	size?: string;
}

// Cell renderer that indents cell content based on tree depth
const TreeNameRenderer = ({ value, rowId, api }: CellRendererProps<FileNode>) => {
	const visualIndex = api.getRowIndexById(rowId) ?? 0;
	const visualRow = api.getVisualRow(visualIndex);
	const depth = visualRow?.depth ?? 0;

	return (
		<div className='flex items-center h-full select-none' style={{ paddingLeft: `${depth * 20}px` }}>
			<span className='mr-2'>{visualRow?.kind === 'group' ? '📁' : '📄'}</span>
			<span className='text-slate-200'>{String(value)}</span>
		</div>
	);
};

export function FileDirectoryGrid({ nodes }: { nodes: FileNode[] }) {
	const columns = useMemo<ColumnDef<FileNode>[]>(
		() => [
			{ field: 'name', header: 'Node Path / Name', width: 300, cellRenderer: TreeNameRenderer },
			{ field: 'size', header: 'Capacity Size', width: 120 },
		],
		[]
	);

	const api = useClientGrid<FileNode>({
		rows: nodes,
		columns,
		initialState: {
			getParentId: (row) => row.parentId, // Identifies hierarchical parents
			groupRowHeight: 38,
		},
	});

	return (
		<div style={{ height: '400px' }}>
			<GridProvider api={api}>
				<OpenGrid />
			</GridProvider>
		</div>
	);
}
```

---

### 3. Interactive Master-Detail Layouts (Nested Grids)

Master-Detail row models render completely custom, expandable components or completely separate interactive sub-grids nested directly under their parent row container.

#### Configuration

Enable master-detail by setting `masterDetailEnabled: true` in your options, and configure detail view heights using `detailRowHeight`. Custom detail rows are rendered with the `detailRowRenderer` prop.

```tsx
import React, { useMemo, useCallback } from 'react';
import { OpenGrid, GridProvider, useClientGrid, type ColumnDef, type VisualRow, type GridApi, type CellRendererProps } from '@open-grid/react';

interface OrderRow {
	id: string;
	customerName: string;
	totalAmount: number;
}

interface OrderItemRow {
	id: string;
	itemName: string;
	price: number;
	quantity: number;
}

// Master grid detail toggle column renderer
const DetailToggleRenderer = ({ rowId, api }: CellRendererProps<OrderRow>) => {
	const isExpanded = api.isDetailExpanded(rowId);
	return (
		<button onClick={() => api.toggleDetailExpanded(rowId)} className='w-5 h-5 font-mono text-purple-400'>
			{isExpanded ? '▼' : '▶'}
		</button>
	);
};

// Separated component for the nested grid portal
const NestedItemsGrid = ({ visualRow, parentApi }: { visualRow: VisualRow<OrderRow>; parentApi: GridApi<OrderRow> }) => {
	if (visualRow.kind !== 'detail') return null;

	const parentOrderId = visualRow.parentId;

	// Mock sub-items associated with parent ID
	const items: OrderItemRow[] = [
		{ id: 'ITM-01', itemName: 'High-Freq Options Feed Sub', price: 2500, quantity: 1 },
		{ id: 'ITM-02', itemName: 'Ultra-Low Latency Port licenses', price: 816.66, quantity: 3 },
	];

	const detailColumns = useMemo<ColumnDef<OrderItemRow>[]>(
		() => [
			{ field: 'id', header: 'Item ID', width: 100 },
			{ field: 'itemName', header: 'Product Item Name', width: 250 },
			{ field: 'price', header: 'Price', width: 100 },
			{ field: 'quantity', header: 'Qty', width: 80 },
		],
		[]
	);

	const detailApi = useClientGrid<OrderItemRow>({
		rows: items,
		columns: detailColumns,
	});

	return (
		<div className='w-full h-full p-4 pl-12 bg-slate-950/90 border-b border-slate-900 flex flex-col gap-2 relative'>
			<div className='text-[10px] text-purple-400 uppercase tracking-widest font-extrabold'>Order Line Items (Parent ID: {parentOrderId})</div>
			<div className='flex-1 min-h-0 border border-slate-850 rounded-lg overflow-hidden bg-slate-900'>
				<GridProvider api={detailApi}>
					<OpenGrid enableNavigation={true} />
				</GridProvider>
			</div>
		</div>
	);
};

export function MasterOrdersGrid({ orders }: { orders: OrderRow[] }) {
	const masterColumns = useMemo<ColumnDef<OrderRow>[]>(
		() => [
			{ field: 'toggle', header: '🔍', width: 45, cellRenderer: DetailToggleRenderer },
			{ field: 'id', header: 'Order ID', width: 120 },
			{ field: 'customerName', header: 'Corporation Client', width: 220 },
			{ field: 'totalAmount', header: 'Value', width: 120 },
		],
		[]
	);

	const api = useClientGrid<OrderRow>({
		rows: orders,
		columns: masterColumns,
		initialState: {
			masterDetailEnabled: true,
			detailRowHeight: 220, // Height in pixels allocated for nested component
		},
	});

	const detailRowRenderer = useCallback(({ visualRow, api }: { visualRow: VisualRow<OrderRow>; api: GridApi<OrderRow> }) => {
		return <NestedItemsGrid visualRow={visualRow} parentApi={api} />;
	}, []);

	return (
		<div style={{ height: '600px' }}>
			<GridProvider api={api}>
				<OpenGrid detailRowRenderer={detailRowRenderer} />
			</GridProvider>
		</div>
	);
}
```

---

### 4. Custom Column Header Filters

Register fully custom header menu popovers (such as multi-select dropdown filters, date pickers, or custom sorts) using React popovers mounted via custom React Portals inside the column header cell.

#### Configuration

To bind a header popover, register your custom header filter component in `headerMenuComponent` inside the target column definition.

```tsx
import React, { useState } from 'react';
import { useGridApi, type GridApi, type ColumnDef } from '@open-grid/react';

interface CustomFilterProps {
	colField: string;
	api: GridApi<any>;
	close: () => void;
}

export const StatusHeaderFilter = ({ colField, api, close }: CustomFilterProps) => {
	const state = api.getState();
	const activeFilter = state.filterModel?.[colField] as any;
	const [selectedValue, setSelectedValue] = useState(activeFilter?.filter || '');

	const handleApply = () => {
		const nextFilter = { ...(state.filterModel || {}) };
		if (selectedValue) {
			nextFilter[colField] = {
				type: 'equals',
				filter: selectedValue,
			};
		} else {
			delete nextFilter[colField];
		}
		api.setFilterModel(Object.keys(nextFilter).length > 0 ? nextFilter : null);
		close(); // Closes the header filter popup
	};

	return (
		<div className='flex flex-col gap-2 p-3 bg-slate-900 border border-slate-800 rounded-lg shadow-xl text-white'>
			<span className='text-[10px] font-bold text-slate-400 uppercase'>Select Status</span>
			<select
				value={selectedValue}
				onChange={(e) => setSelectedValue(e.target.value)}
				className='bg-slate-950 border border-slate-850 p-1 rounded text-xs'
			>
				<option value=''>(All Statuses)</option>
				<option value='Active'>Active</option>
				<option value='Pending'>Pending</option>
				<option value='Inactive'>Inactive</option>
			</select>
			<div className='flex justify-end gap-2 mt-2 pt-2 border-t border-slate-800'>
				<button onClick={handleApply} className='bg-purple-600 text-white text-xs px-2.5 py-1 rounded'>
					Apply Filter
				</button>
			</div>
		</div>
	);
};

// Inside ColumnDef registrations:
// {
//     field: 'status',
//     header: 'Fulfillment Status',
//     width: 140,
//     headerMenuComponent: StatusHeaderFilter
// }
```

---

## 🛠️ Public API Reference (`GridApi`)

Application code coordinates with the spreadsheet engine through the standard `GridApi` interface. In React, this handle can be retrieved anywhere inside the tree using the `useGridApi()` hook.

### Core API Methods

| Method                     | Type Signature                                              | Description                                                          |
| :------------------------- | :---------------------------------------------------------- | :------------------------------------------------------------------- |
| **`getState`**             | `() => GridState`                                           | Retrieves the entire synchronous state snapshot.                     |
| **`getCellValue`**         | `(rowId: string, colField: string) => unknown`              | Retrieves the calculated cell value from the cellular cache.         |
| **`setCellValue`**         | `(rowId: string, colField: string, value: unknown) => void` | Mutates a cell value and journals a new history event for undo/redo. |
| **`getCellState`**         | `(rowId: string, colField: string) => CellState`            | Retrieves cell details (e.g. value, computedValue, isEditing).       |
| **`selectCell`**           | `(pointer: GridCellPointer \| null) => void`                | Sets active cell focus and triggers `focusChanged` events.           |
| **`selectRange`**          | `(start: Pointer \| null, end: Pointer \| null) => void`    | Highlight an Excel-like selection bounding box.                      |
| **`setColumnWidth`**       | `(colField: string, width: number) => void`                 | Dynamically resizes a column's layout boundary in pixels.            |
| **`setColumns`**           | `(columns: ColumnDef[]) => void`                            | Updates active grid schema and re-compiles path accessors.           |
| **`setSortModel`**         | `(sortModel: SortModel \| null) => void`                    | Sets sorting schema (supports multi-column sort).                    |
| **`setFilterModel`**       | `(filterModel: FilterModel \| null) => void`                | Sets filtering schema (supports custom operators per column).        |
| **`toggleGroupExpanded`**  | `(groupId: string) => void`                                 | Toggles expanded/collapsed state of a grouped folder node.           |
| **`toggleDetailExpanded`** | `(rowId: string) => void`                                   | Toggles expansion of nested detail grid portals.                     |
| **`getVisualRow`**         | `(index: number) => VisualRow \| null`                      | Resolves visual layout state at a specific visible index.            |
| **`subscribeToKey`**       | `(key: string, listener: Listener) => () => void`           | Subscribes selectively to updates for a specific coordinate key.     |
| **`addEventListener`**     | `(type: string, cb: GridEventListener) => () => void`       | Registers grid-wide action hooks (e.g. `cellValueChanged`).          |
| **`undo` / `redo`**        | `() => void`                                                | Traverse through state mutation journal history.                     |

---

## 💡 Real-world API Examples

### 1. Multi-Cell Value Operations

Perform multi-cell edits sequentially. The engine batched cell invalidations internally:

```typescript
const api = useGridApi();

api.batch(() => {
	api.setCellValue('S-1001', 'revenue', 150000);
	api.setCellValue('S-1001', 'opex', 80000);
	api.selectCell({ rowId: 'S-1001', colField: 'revenue' });
});
```

### 2. State-Driven Conditional Styling (`styleSlots`)

Provide conditional predicates to style rows or cells dynamically based on live business values:

```tsx
const api = useClientGrid<ProductRow>({
	rows,
	columns,
	initialState: {
		styleSlots: {
			rowClass: (row, params) => {
				return row.status === 'Inactive' ? 'bg-slate-900/50 opacity-60' : '';
			},
			cellClass: (col, row, params) => {
				if (col.field === 'price' && Number(row.price) > 500) {
					return 'text-rose-400 font-extrabold bg-rose-950/10 border-rose-800/30';
				}
				return '';
			},
		},
	},
});
```

### 3. Highly Granular Cell-Level Pub-Sub Subscriptions

Subscribe directly to changes in a single cell without triggering global React rerenders on adjacent cells:

```typescript
const api = useGridApi();

// Subscribes strictly to coordinate changes for S-1002 in column 'A'
const unsub = api.subscribeToKey('cell:value:S-1002:A', (state) => {
	const latestValue = api.getCellValue('S-1002', 'A');
	console.log('Instant cell update received:', latestValue);
});

// Call when dismantling listeners or unmounting custom cell components
unsub();
```

---

## 🎨 Creating Custom Cell Renderers & Editors

Open Grid allows you to build highly customized visual presentation slots and complex editing dropdowns by creating React components.

### 1. Custom Cell Renderer (Interactive Star Ratings)

Renderers are used for stunning presentation of passive values or simple interactive widgets:

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
		<div className='flex items-center gap-1 select-none cursor-pointer h-full'>
			{[1, 2, 3, 4, 5].map((star) => (
				<button key={star} onClick={(e) => handleStarClick(star, e)}>
					<svg
						className={`w-4 h-4 ${star <= rating ? 'text-amber-400 fill-amber-400' : 'text-slate-650'}`}
						xmlns='http://www.w3.org/2050/svg'
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

Editors handle active inline cell editing (e.g. text-entry or status selection), offering hooks to commit or cancel operations.

```tsx
import React from 'react';
import type { CellEditorProps } from '@open-grid/react';

export const StatusDropdownEditor = ({ value, onCommit, onCancel }: CellEditorProps<ProductRow>) => {
	return (
		<select
			autoFocus
			value={value as string}
			onChange={(e) => onCommit(e.target.value)} // Commit value and close edit mode
			onMouseDown={(e) => e.stopPropagation()} // Prevent cell focus shifting
			onDoubleClick={(e) => e.stopPropagation()}
			onKeyDown={(e) => {
				if (e.key === 'Escape') onCancel(); // Cancel editing
			}}
			className='absolute inset-0 w-full h-full px-2 text-xs bg-slate-900 text-white border-2 border-purple-500 outline-none z-20 font-semibold cursor-pointer'
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

Open Grid supports scoped spreadsheet formulas as an optional engine behavior. You can pass formula expressions starting with `=` as cell values, and the engine automatically recalculates computed values when source cells are edited.

### Writing Formulas

Formula strings specify cell references using `[rowId:columnField]` coordinate targets:

```typescript
// S-1001:C is calculated reactively as Revenue minus OpEx
api.setCellValue('S-1001', 'C', '=SUM([S-1001:A],-[S-1001:B])');

// S-1001:F scales the computed value of S-1001:C dynamically
api.setCellValue('S-1001', 'F', '=[S-1001:C]*0.8');
```

Whenever `S-1001:A` or `S-1001:B` changes, the calculated output for `C` and `F` is marked invalid and recalculated lazily upon access.

> [!NOTE]
> Formula support handles explicit `[rowId:columnField]` references, numeric arithmetic, parentheses, string fallback values, and operations like `SUM`, `AVERAGE`, `MIN`, and `MAX`.

---

## 🛠️ Scripts & Local Developer Guides

### 1. Running Unit Tests

Open Grid uses Vitest for core correctness tests around formulas, virtualization geometry, and row model sorting and grouping pipelines.

```bash
pnpm run test
```

### 2. Compiling Packages

Compile TypeScript files in watch or production bundle configurations:

```bash
pnpm run build
```

### 3. Launching Vite Showroom Dashboard

Start the local Vite high-fidelity showroom application:

```bash
pnpm dev:demo
```

Open your browser to `http://localhost:5173` to explore the **Calculations Arena**, **Spreadsheet Workspace** (ranges, formulas, series drag handles), and **Hierarchical & Relational Layout Desk** (expandable row groups, directories, and nested sub-grids).

---

## 👑 Author & Creator

**Rishikesh Kumar**  
Lead Architect of Open Grid

---

## 📄 License

Open Grid is licensed under the [MIT License](LICENSE).
