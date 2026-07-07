export interface GridRowDataRef<TRowData = unknown> {
	readonly id: string;
	readonly data: TRowData;
	getData(): TRowData;
	getValue<TValue = unknown>(field: string): TValue | undefined;
	getDisplayValue(field: string): string;
}

function getValueByPath(data: unknown, field: string): unknown {
	if (!field) return undefined;
	const parts = field.split('.');
	let current: unknown = data;
	for (const part of parts) {
		if (current == null || typeof current !== 'object') return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

export function createGridRowDataRef<TRowData>(id: string, data: TRowData): GridRowDataRef<TRowData> {
	return {
		id,
		data,
		getData() {
			return data;
		},
		getValue<TValue = unknown>(field: string): TValue | undefined {
			return getValueByPath(data, field) as TValue | undefined;
		},
		getDisplayValue(field: string): string {
			const value = getValueByPath(data, field);
			return value == null ? '' : String(value);
		},
	};
}
