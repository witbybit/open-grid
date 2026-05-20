# Open-Grid Architecture Diagram

## Component Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                        GridProvider                          │
│                    (React Context)                           │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                     GridStore                          │ │
│  │              (Core State Management)                   │ │
│  │                                                        │ │
│  │  • State: columns, rows, focus, selection, editing    │ │
│  │  • Methods: setCellValue, getCellValue, setState      │ │
│  │  • Events: cellValueChanged, editStopped, etc.        │ │
│  │  • Features: Navigation, RowModel, etc.               │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │           GridNavigationController                     │ │
│  │              (Feature Plugin)                          │ │
│  │                                                        │ │
│  │  • Keyboard navigation (arrows, tab, enter)           │ │
│  │  • Mouse selection (click, drag)                      │ │
│  │  • Edit mode management                               │ │
│  │  • Event bridge: cellValueChanged → onCellValueChanged│ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    GridView                            │ │
│  │              (React Component)                         │ │
│  │                                                        │ │
│  │  • Virtual scrolling (@tanstack/react-virtual)        │ │
│  │  • Header rendering                                   │ │
│  │  • Row rendering                                      │ │
│  │  • Keyboard event handling                            │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                  VirtualRow                            │ │
│  │              (React Component)                         │ │
│  │                                                        │ │
│  │  • Renders cells for a single row                     │ │
│  │  • Positioned absolutely for virtualization           │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                     Cell                               │ │
│  │              (React Component)                         │ │
│  │                                                        │ │
│  │  • Display mode: Shows value or custom renderer       │ │
│  │  • Edit mode: Shows input or custom editor            │ │
│  │  • Manages local editing state                        │ │
│  │  • Handles commit/cancel logic                        │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Custom Cell Editor                        │ │
│  │         (User-Provided Component)                      │ │
│  │                                                        │ │
│  │  • StatusDropdownEditor                               │ │
│  │  • ProgressSliderEditor                               │ │
│  │  • TextEditor                                         │ │
│  │  • etc.                                               │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Cell Value Change Flow (Simplified)

```
┌─────────────────────────────────────────────────────────────┐
│                    USER INTERACTION                          │
│              (e.g., select dropdown option)                  │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              Custom Editor Component                         │
│         (e.g., StatusDropdownEditor)                         │
│                                                              │
│         onChange={(e) => onCommit(e.target.value)}          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  Cell Component                              │
│                                                              │
│  handleCommit(value) {                                       │
│    if (isCommittedRef.current) return; // Guard             │
│    isCommittedRef.current = true;                           │
│    api.setCellValue(rowId, colField, value);                │
│    api.stopEditing(false);                                  │
│  }                                                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   GridStore                                  │
│                                                              │
│  setCellValue(rowId, colField, value) {                     │
│    // Update row model                                      │
│    rowModel.setCellValue(rowId, colField, value);           │
│                                                              │
│    // Trigger cell notifications                            │
│    triggerCellNotifications(rowId);                         │
│                                                              │
│    // Dispatch event                                        │
│    dispatchEvent('cellValueChanged', {                      │
│      rowId, colField, oldValue, newValue                    │
│    });                                                       │
│  }                                                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│          GridNavigationController                            │
│                                                              │
│  init(api) {                                                 │
│    api.addEventListener('cellValueChanged', (event) => {    │
│      const { rowId, colField, newValue } = event.payload;   │
│      this.options.onCellValueChanged?.(                     │
│        rowId, colField, newValue                            │
│      );                                                      │
│    });                                                       │
│  }                                                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    GridView                                  │
│                                                              │
│  useGridNavigationController({                              │
│    onCellValueChanged: (rowId, colField, val) => {          │
│      onCellValueChanged(rowId, colField, val);              │
│    }                                                         │
│  });                                                         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  User Callback                               │
│         (e.g., handleLayoutCellValueChanged)                 │
│                                                              │
│  handleLayoutCellValueChanged(rowId, colField, val) {       │
│    layoutController.updateRows((rows) =>                    │
│      rows.map((row) => {                                    │
│        if (row.id === rowId) {                              │
│          return { ...row, [colField]: val };                │
│        }                                                     │
│        return row;                                          │
│      })                                                      │
│    );                                                        │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
```

## State Management Flow

```
┌─────────────────────────────────────────────────────────────┐
│                      GridStore                               │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    State                               │ │
│  │                                                        │ │
│  │  • columns: ColumnDef[]                               │ │
│  │  • focusedCell: { rowId, colField } | null            │ │
│  │  • selectedRange: { start, end } | null               │ │
│  │  • activeEdit: { rowId, colField } | null             │ │
│  │  • rowHeights: Record<string, number>                 │ │
│  │  • columnWidths: Record<string, number>               │ │
│  │  • dataVersion: number                                │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Subscription System                       │ │
│  │                                                        │ │
│  │  • Global listeners: subscribe()                      │ │
│  │  • Key listeners: subscribeToKey(key)                 │ │
│  │  • Cell-specific: cell:value:rowId:colField           │ │
│  │  • Focus-specific: cell:focus:rowId:colField          │ │
│  │  • Edit-specific: cell:edit:rowId:colField            │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                Event System                            │ │
│  │                                                        │ │
│  │  • addEventListener(type, callback)                   │ │
│  │  • dispatchEvent(type, payload)                       │ │
│  │  • Events: cellValueChanged, editStopped,             │ │
│  │            focusChanged, selectionChanged, etc.       │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## React Hook Integration

```
┌─────────────────────────────────────────────────────────────┐
│                  React Hooks Layer                           │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  useGridStore()                                        │ │
│  │  • Access GridStore from context                      │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  useGridApi()                                          │ │
│  │  • Access GridApi methods                             │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  useGridSelector(selector)                            │ │
│  │  • Subscribe to derived state                         │ │
│  │  • Uses useSyncExternalStore                          │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  useGridKeySelector(key, selector)                    │ │
│  │  • Subscribe to specific state key                    │ │
│  │  • Optimized for targeted updates                     │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  useGridCell(rowId, colField)                         │ │
│  │  • Subscribe to single cell value                     │ │
│  │  • O(1) updates, no row re-renders                    │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  useGridCellProps(options)                            │ │
│  │  • Complete cell props with handlers                  │ │
│  │  • Focus, selection, editing state                    │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  useGridNavigationController(options)                 │ │
│  │  • Create and register navigation controller          │ │
│  │  • Bridge events to user callbacks                    │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Editor Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                    DISPLAY MODE                              │
│                                                              │
│  Cell shows:                                                 │
│  • Custom renderer (if provided)                            │
│  • Default text display                                     │
│                                                              │
│  User action:                                               │
│  • Double-click (default)                                   │
│  • Single-click (if configured)                             │
│  • Press Enter                                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                 ENTER EDIT MODE                              │
│                                                              │
│  navigation.setCellEditing(rowId, colField, true)           │
│  store.setState({ activeEdit: { rowId, colField } })        │
│                                                              │
│  Cell component:                                            │
│  • isEditing = true                                         │
│  • isCommittedRef.current = false                           │
│  • localValue = cellState.value                             │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    EDITING MODE                              │
│                                                              │
│  Cell renders:                                              │
│  • Custom editor (if provided)                              │
│  • Default text input                                       │
│                                                              │
│  Editor receives:                                           │
│  • value: current cell value                                │
│  • onChange: update local state                             │
│  • onCommit: commit and exit                                │
│  • onCancel: cancel and exit                                │
│                                                              │
│  User can:                                                  │
│  • Type/select/interact                                     │
│  • Press Enter → commit                                     │
│  • Press Escape → cancel                                    │
│  • Click away → commit (for text inputs)                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  COMMIT OR CANCEL                            │
│                                                              │
│  COMMIT:                                                    │
│  • onCommit(value) called                                   │
│  • Cell: handleCommit(value)                                │
│  • api.setCellValue(rowId, colField, value)                 │
│  • api.stopEditing(false)                                   │
│  • Event chain triggers                                     │
│                                                              │
│  CANCEL:                                                    │
│  • onCancel() called                                        │
│  • Cell: handleCancel()                                     │
│  • api.stopEditing(true)                                    │
│  • No value change                                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                 EXIT EDIT MODE                               │
│                                                              │
│  store.setState({ activeEdit: null })                       │
│  store.dispatchEvent('editStopped', { rowId, colField })    │
│                                                              │
│  Cell component:                                            │
│  • isEditing = false                                        │
│  • Returns to display mode                                  │
└─────────────────────────────────────────────────────────────┘
```

## Key Design Principles

### 1. **Single Responsibility**
- **Cell**: Manages edit lifecycle and commit guards
- **Editor**: Handles user interaction and calls callbacks
- **Store**: Manages state and dispatches events
- **Navigation**: Bridges events to user callbacks

### 2. **Clear Boundaries**
- Editors don't know about commit guards
- Cell doesn't know about editor internals
- Store doesn't know about React
- Navigation doesn't know about UI

### 3. **Event-Driven**
- State changes trigger events
- Features subscribe to events
- Loose coupling between components

### 4. **Performance Optimized**
- Fine-grained subscriptions (cell-level)
- O(1) state updates
- Minimal re-renders
- Virtual scrolling

### 5. **Extensible**
- Plugin-based features
- Custom editors/renderers
- Event system for extensions
- Type-safe APIs
