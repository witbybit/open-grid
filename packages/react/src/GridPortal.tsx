import { type ReactNode, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { GridPortalStore, PortalEntry } from './gridPortalStore.js';

export interface CellRendererProps {
	readonly cellKey: string;
	readonly rowId: string | number | null;
	readonly field: string;
	readonly value: unknown;
	readonly row: unknown;
	readonly isEditing: boolean;
}

export interface GridPortalProps {
	store: GridPortalStore;
	columnRenderers?: Map<string, React.ComponentType<CellRendererProps>>;
	columnEditors?: Map<string, React.ComponentType<CellRendererProps>>;
}

function renderEntry(
	entry: PortalEntry,
	columnRenderers: Map<string, React.ComponentType<CellRendererProps>> | undefined,
	columnEditors: Map<string, React.ComponentType<CellRendererProps>> | undefined
): ReactNode {
	const props: CellRendererProps = {
		cellKey: entry.cellKey,
		rowId: entry.rowId,
		field: entry.field,
		value: entry.value,
		row: entry.row,
		isEditing: entry.isEditing,
	};

	if (entry.isEditing) {
		const Editor = columnEditors?.get(entry.field);
		if (Editor) return <Editor {...props} />;
	}
	const Renderer = columnRenderers?.get(entry.field);
	if (Renderer) return <Renderer {...props} />;
	return null;
}

/**
 * Subscribes to a GridPortalStore and renders React portals into each registered
 * cell container. Custom cellRenderers and cellEditors are resolved per column field.
 */
export function GridPortal({ store, columnRenderers, columnEditors }: GridPortalProps): React.ReactElement {
	const entries = useSyncExternalStore(store.subscribe, store.getEntries, store.getEntries);

	return (
		<>
			{entries.map((entry) => {
				const content = renderEntry(entry, columnRenderers, columnEditors);
				if (content === null) return null;
				return createPortal(content, entry.container, entry.cellKey);
			})}
		</>
	);
}
