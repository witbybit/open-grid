export interface IndexMapperEntry<TId extends string = string> {
	id: TId;
	visible: boolean;
}

export class IndexMapper<TId extends string = string> {
	private entries: IndexMapperEntry<TId>[] = [];
	private visualToPhysical: number[] = [];
	private physicalToVisual = new Map<number, number>();
	private idToPhysical = new Map<TId, number>();
	private idToVisual = new Map<TId, number>();

	public setIds(ids: TId[]): void {
		this.entries = ids.map((id) => ({ id, visible: true }));
		this.rebuild();
	}

	public get length(): number {
		return this.visualToPhysical.length;
	}

	public getPhysicalCount(): number {
		return this.entries.length;
	}

	public getVisibleIds(): TId[] {
		return this.visualToPhysical.map((physicalIndex) => this.entries[physicalIndex].id);
	}

	public visualToPhysicalIndex(visualIndex: number): number {
		return this.visualToPhysical[visualIndex] ?? -1;
	}

	public physicalToVisualIndex(physicalIndex: number): number {
		return this.physicalToVisual.get(physicalIndex) ?? -1;
	}

	public idToVisualIndex(id: TId): number {
		return this.idToVisual.get(id) ?? -1;
	}

	public idToPhysicalIndex(id: TId): number {
		return this.idToPhysical.get(id) ?? -1;
	}

	public visualIndexToId(visualIndex: number): TId | null {
		const physicalIndex = this.visualToPhysicalIndex(visualIndex);
		return physicalIndex >= 0 ? this.entries[physicalIndex].id : null;
	}

	public physicalIndexToId(physicalIndex: number): TId | null {
		return this.entries[physicalIndex]?.id ?? null;
	}

	public moveVisibleIndex(fromVisualIndex: number, toVisualIndex: number): void {
		if (fromVisualIndex < 0 || fromVisualIndex >= this.visualToPhysical.length) return;
		const clampedTarget = Math.max(0, Math.min(this.visualToPhysical.length - 1, Math.trunc(toVisualIndex)));
		if (fromVisualIndex === clampedTarget) return;

		const visibleEntries = this.visualToPhysical.map((physicalIndex) => this.entries[physicalIndex]);
		const [entry] = visibleEntries.splice(fromVisualIndex, 1);
		visibleEntries.splice(clampedTarget, 0, entry);

		const hiddenEntries = this.entries.filter((entry) => !entry.visible);
		this.entries = [...visibleEntries, ...hiddenEntries];
		this.rebuild();
	}

	public setVisible(id: TId, visible: boolean): void {
		const physicalIndex = this.idToPhysicalIndex(id);
		if (physicalIndex < 0) return;
		if (this.entries[physicalIndex].visible === visible) return;
		this.entries[physicalIndex] = { ...this.entries[physicalIndex], visible };
		this.rebuild();
	}

	private rebuild(): void {
		this.visualToPhysical = [];
		this.physicalToVisual.clear();
		this.idToPhysical.clear();
		this.idToVisual.clear();

		for (let physicalIndex = 0; physicalIndex < this.entries.length; physicalIndex++) {
			const entry = this.entries[physicalIndex];
			this.idToPhysical.set(entry.id, physicalIndex);
			if (!entry.visible) continue;

			const visualIndex = this.visualToPhysical.length;
			this.visualToPhysical.push(physicalIndex);
			this.physicalToVisual.set(physicalIndex, visualIndex);
			this.idToVisual.set(entry.id, visualIndex);
		}
	}
}
