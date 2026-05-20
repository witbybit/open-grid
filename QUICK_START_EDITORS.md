# Quick Start: Custom Cell Editors

## TL;DR

**Immediate commit (dropdown, checkbox):**
```typescript
const MyEditor = ({ value, onCommit }) => (
  <select value={value} onChange={(e) => onCommit(e.target.value)}>
    <option>Option 1</option>
  </select>
);
```

**Progressive commit (text input):**
```typescript
const MyEditor = ({ value, onChange, onCommit, onCancel }) => (
  <input
    value={value}
    onChange={(e) => onChange(e.target.value)}
    onBlur={() => onCommit()}
    onKeyDown={(e) => {
      if (e.key === 'Enter') onCommit();
      if (e.key === 'Escape') onCancel();
    }}
  />
);
```

## Complete Examples

### Dropdown Editor
```typescript
import { CellEditorProps } from '@open-grid/core';

export const StatusDropdownEditor = ({ value, onCommit }: CellEditorProps<any>) => {
  return (
    <select
      autoFocus
      value={value as string}
      onChange={(e) => onCommit(e.target.value)}
      className='absolute inset-0 w-full h-full px-3 bg-slate-900 border-2 border-purple-500'
    >
      <option value='Active'>Active</option>
      <option value='Pending'>Pending</option>
      <option value='Inactive'>Inactive</option>
    </select>
  );
};
```

### Text Input Editor
```typescript
export const TextEditor = ({ value, onChange, onCommit, onCancel }: CellEditorProps<any>) => {
  return (
    <input
      autoFocus
      type='text'
      value={value as string}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      className='absolute inset-0 w-full h-full px-3 bg-slate-900 border-2 border-purple-500'
    />
  );
};
```

### Number Input Editor
```typescript
export const NumberEditor = ({ value, onChange, onCommit, onCancel }: CellEditorProps<any>) => {
  return (
    <input
      autoFocus
      type='number'
      value={Number(value) || 0}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit();
        if (e.key === 'Escape') onCancel();
      }}
      className='absolute inset-0 w-full h-full px-3 bg-slate-900 border-2 border-purple-500'
    />
  );
};
```

### Checkbox Editor
```typescript
export const CheckboxEditor = ({ value, onCommit }: CellEditorProps<any>) => {
  return (
    <div className='absolute inset-0 flex items-center justify-center bg-slate-900 border-2 border-purple-500'>
      <input
        autoFocus
        type='checkbox'
        checked={Boolean(value)}
        onChange={(e) => onCommit(e.target.checked)}
        className='w-5 h-5'
      />
    </div>
  );
};
```

### Slider Editor
```typescript
export const SliderEditor = ({ value, onChange, onCommit }: CellEditorProps<any>) => {
  return (
    <div className='absolute inset-0 flex items-center px-3 bg-slate-900 border-2 border-purple-500'>
      <input
        autoFocus
        type='range'
        min='0'
        max='100'
        value={Number(value) || 0}
        onChange={(e) => onChange(e.target.value)}
        onMouseUp={() => onCommit()}
        className='w-full'
      />
    </div>
  );
};
```

### Date Picker Editor
```typescript
export const DateEditor = ({ value, onChange, onCommit, onCancel }: CellEditorProps<any>) => {
  return (
    <input
      autoFocus
      type='date'
      value={value as string}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit();
        if (e.key === 'Escape') onCancel();
      }}
      className='absolute inset-0 w-full h-full px-3 bg-slate-900 border-2 border-purple-500'
    />
  );
};
```

### Color Picker Editor
```typescript
export const ColorEditor = ({ value, onCommit }: CellEditorProps<any>) => {
  return (
    <input
      autoFocus
      type='color'
      value={value as string}
      onChange={(e) => onCommit(e.target.value)}
      className='absolute inset-0 w-full h-full cursor-pointer'
    />
  );
};
```

### Multi-Select Editor
```typescript
export const MultiSelectEditor = ({ value, onChange, onCommit, onCancel }: CellEditorProps<any>) => {
  const [selected, setSelected] = useState<string[]>(value as string[] || []);
  
  const toggleOption = (option: string) => {
    const newSelected = selected.includes(option)
      ? selected.filter(o => o !== option)
      : [...selected, option];
    setSelected(newSelected);
    onChange(newSelected);
  };
  
  return (
    <div className='absolute inset-0 bg-slate-900 border-2 border-purple-500 p-2 overflow-auto'>
      {['Option 1', 'Option 2', 'Option 3'].map(option => (
        <label key={option} className='flex items-center gap-2 mb-1'>
          <input
            type='checkbox'
            checked={selected.includes(option)}
            onChange={() => toggleOption(option)}
          />
          {option}
        </label>
      ))}
      <div className='flex gap-2 mt-2'>
        <button onClick={() => onCommit(selected)}>Save</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
};
```

### Rich Text Editor (with buttons)
```typescript
export const RichTextEditor = ({ value, onChange, onCommit, onCancel }: CellEditorProps<any>) => {
  const [text, setText] = useState(value as string || '');
  
  return (
    <div className='absolute inset-0 bg-slate-900 border-2 border-purple-500 flex flex-col'>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value);
        }}
        className='flex-1 p-2 bg-transparent outline-none resize-none'
      />
      <div className='flex gap-2 p-2 border-t border-slate-700'>
        <button onClick={() => onCommit(text)}>Save</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
};
```

## Using Custom Editors

Add your editor to a column definition:

```typescript
import { GridStore, ColumnDef } from '@open-grid/core';
import { StatusDropdownEditor } from './editors';

const columns: ColumnDef<MyRowType>[] = [
  {
    field: 'status',
    header: 'Status',
    width: 150,
    cellEditor: StatusDropdownEditor, // ✅ Just assign it!
  },
  {
    field: 'name',
    header: 'Name',
    width: 200,
    // No cellEditor = default text input
  },
];

const store = new GridStore({ columns });
```

## API Reference

### CellEditorProps

```typescript
interface CellEditorProps<TRowData = unknown> {
  rowId: string;        // ID of the row being edited
  colField: string;     // Field name of the column
  value: unknown;       // Current cell value
  
  onChange: (value: unknown) => void;     // Update local state (optional)
  onCommit: (value?: unknown) => void;    // Commit and exit edit mode
  onCancel: () => void;                   // Cancel and exit edit mode
  
  api: GridApi<TRowData>;                 // Full grid API access
}
```

### When to Use What

| Callback | Use Case | Example |
|----------|----------|---------|
| `onCommit(value)` | Immediate commit | Dropdown selection, checkbox toggle |
| `onChange` + `onCommit()` | Progressive commit | Text input (type then blur), slider (drag then release) |
| `onCancel()` | Discard changes | Escape key, cancel button |

## Common Patterns

### Stop Event Propagation
Prevent grid navigation while editing:

```typescript
<input
  onMouseDown={(e) => e.stopPropagation()}
  onDoubleClick={(e) => e.stopPropagation()}
/>
```

### Auto-focus
Focus the editor when it opens:

```typescript
<input autoFocus />
```

### Keyboard Shortcuts
Handle Enter/Escape:

```typescript
<input
  onKeyDown={(e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      onCommit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  }}
/>
```

### Styling
Position editor absolutely to overlay the cell:

```typescript
<input className='absolute inset-0 w-full h-full px-3 ...' />
```

## Tips

1. **Always call `onCommit` or `onCancel`** - Don't leave the editor hanging
2. **Use `autoFocus`** - Better UX, user can start typing immediately
3. **Stop propagation** - Prevent grid navigation events
4. **Handle Escape** - Let users cancel edits
5. **Handle Enter** - Let users commit quickly
6. **Position absolutely** - Overlay the cell for seamless editing

## Troubleshooting

### Editor doesn't commit
- Make sure you're calling `onCommit(value)` or `onCommit()`
- Check that you're not calling it inside a condition that never triggers

### Double commits
- Don't worry! The framework prevents double commits automatically
- You don't need `useRef` guards

### Value not updating
- For immediate commit: Just call `onCommit(value)`
- For progressive commit: Call `onChange(value)` while editing, then `onCommit()`

### Editor loses focus
- Add `autoFocus` to your input
- Make sure you're not re-rendering the editor unnecessarily

## Need Help?

See the full documentation:
- [CELL_EDITOR_API.md](./CELL_EDITOR_API.md) - Detailed API guide
- [ARCHITECTURE_IMPROVEMENTS.md](./ARCHITECTURE_IMPROVEMENTS.md) - Architecture overview
