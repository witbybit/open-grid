# Headless High-Performance Data Grid & Spreadsheet Engine

A lightweight, unstyled, and modular headless grid engine built specifically for high-performance virtualized spreadsheets. By decoupling rendering from state management using a framework-agnostic core and targeted pub-sub subscriptions, the engine achieves sub-millisecond cell updates, handles **100,000+ rows at 60+ FPS**, and avoids global React re-renders.

---

## ⚡ Key Technical Architecture

To bypass the React virtual DOM rendering bottleneck (which slows down standard grids), the core operates on an **out-of-render state loop**:

```mermaid
graph TD
    A[GridStore / Pub-Sub Database] --> B[Row Models]
    B --> C[Client-Side Row Model]
    B --> D[Server-Side Infinite Block Paginator]

    A --> E[GridNavigationController / Keyboard State Machine]
    A --> F[Pluggable Formulas & Recalculators]

    A --> G[Framework Adapters]
    G --> H[@open-grid/react bindings]

    H --> I[Developer's Custom DOM / TanStack Virtualizer / Canvas]
```

### Core Architecture Highlights

1. **Targeted Micro-Subscriptions**: Cell components subscribe strictly to their own coordinate key (e.g. `cell:r,c`). Mutating a single cell's value or coordinates triggers _only_ that cell's component render tree, keeping performance `O(1)` per update.
2. **Dynamic Listener Garbage Collection**: Subscription listeners are active only for elements currently in the scroll viewport. Scrolling elements out of the viewport automatically unmounts them, dereferencing their subscriptions to prevent memory leaks and keep lookups lightning-fast.
3. **Unified Programmatic API (`GridApi`)**: Exposes an absolute control handle which is injected into all custom cell components, headers, and editor inputs, giving them full programmatic control over cells, sizes, focus, and selection.
4. **Complete Layout Freedom**: We render no table elements. We manage keyboard traps, scroll caching blocks, coordinates, dimensions, and selection math. The developer has total styling freedom to construct their DOM tree (standard table tags, flex, canvas, virtualizers).

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
          │   ├── App.tsx        # High-fidelity virtualized showcase dashboard
          │   └── index.css      # Tailwind setup & glow styles
          ├── vite.config.ts
          └── tailwind.config.js
```

---

## 🛠️ Public Interfaces & APIs

### 1. `GridApi` State Mutation Methods

The central API handle available anywhere via context (`useGridApi()`):

| Method                 | Type Signature                                 | Description                                                            |
| :--------------------- | :--------------------------------------------- | :--------------------------------------------------------------------- |
| **`getState`**         | `() => GridState`                              | Retrieves the entire synchronous state snapshot.                       |
| **`setState`**         | `(updater: GridStateUpdater) => void`          | Updates specific keys in state, triggering selective listeners.        |
| **`setCellValue`**     | `(row: number, col: number, val: any) => void` | Updates a cell value and dispatches `cellValueChanged` event.          |
| **`getCellState`**     | `(row: number, col: number) => CellState`      | Safely reads a cell's current value, computed formula, or edit status. |
| **`setFocusedCell`**   | `(row: number, col: number) => void`           | Focuses on a specific coordinate and dispatches `focusChanged` event.  |
| **`setSelectedRange`** | `(start: Coord, end: Coord) => void`           | Highlights a range selection and dispatches `selectionChanged` event.  |
| **`setColumnWidth`**   | `(col: number, width: number) => void`         | Resizes a column and dispatches `columnResized` event.                 |
| **`setRowHeight`**     | `(row: number, height: number) => void`        | Resizes a row and dispatches `rowResized` event.                       |

---

## 🔌 Pluggable Event System

The core store broadcasts structured event payloads when functional shifts occur. You can register custom callbacks or event logging plugins using:

```typescript
const unsub = api.addEventListener('cellValueChanged', (event) => {
	const { row, col, oldValue, newValue } = event.payload;
	console.log(`Cell at (${row}, ${col}) changed from ${oldValue} to ${newValue}`);
});

// Call unsub() to clean up listener bindings
unsub();
```

### Supported Events

- **`cellValueChanged`**: Dispatched on cell updates. Payload: `{ row: number, col: number, oldValue: any, newValue: any }`
- **`columnResized`**: Dispatched on header drag-resize. Payload: `{ col: number, width: number }`
- **`rowResized`**: Dispatched on row index drag-resize. Payload: `{ row: number, height: number }`
- **`focusChanged`**: Dispatched on cell focus updates. Payload: `{ focusedCell: GridCellCoordinate \| null }`
- **`selectionChanged`**: Dispatched on selection range expansion. Payload: `{ selectedRange: GridCellRange \| null }`

---

## 🎨 Custom Cell Editors & Renderers

Developing custom inputs is extremely easy. The grid core provides standard prop interfaces which include the fully-empowered `GridApi` to execute dynamic cross-cell calculations or programmatically modify other cells from inside the editor.

### 1. Column Definitions Configuration

Extend your column schema lists to register custom editor React components:

```typescript
import { CellEditorProps } from '@open-grid/react';

const StatusCellEditor = ({ row, col, value, api }: CellEditorProps) => {
  return (
    <select
      autoFocus
      value={value}
      onChange={(e) => {
        const nextVal = e.target.value;

        // 1. Programmatically write status value to this cell
        api.setCellValue(row, col, nextVal);

        // 2. Programmatically close editing mode
        api.setState({ activeEditCell: null, activeEditValue: '' });

        // 3. E2E GridApi Side-Effect: Set Price (Col 2) & Qty (Col 3) to 0 if status is Inactive
        if (nextVal === 'Inactive') {
          api.setCellValue(row, 2, '0');
          api.setCellValue(row, 3, '0');
        }
      }}
      className="absolute inset-0 bg-slate-900 text-white border-2 border-purple-500"
    >
      <option value="Active">Active</option>
      <option value="Inactive">Inactive</option>
    </select>
  );
};

const COLUMNS = [
  { header: 'Product Name', width: 180 },
  { header: 'Price ($)', width: 120 },
  { header: 'Status', width: 120, cellEditor: StatusCellEditor },
];
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

Executes the comprehensive core state test suite verifying coordinate selections, targeted subscriptions, events, and dimensions:

```bash
pnpm run test
```

#### Compile TS Workspace Packages

Runs TypeScript compiler on core and react packages:

```bash
pnpm run build
```

#### Launch Vite Dashboard Dev Server

Fires up the premium virtualized React demonstration dashboard locally:

```bash
pnpm dev:demo
```

Once active, navigate your browser to the local URL (default is `http://localhost:5173`) to test interactive resizes, formula evaluations, custom dropdown select editors, and core transaction logs in the event inspector!

---

## 👑 Author & Creator

**Rishikesh Kumar**
Lead Architect of Grid Engine

---
