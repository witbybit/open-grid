import type { CanonicalGridCellPointer } from '../api/GridApi.js';

export type ProgrammaticScrollTarget =
	| {
			kind: 'row';
			rowId: string;
	  }
	| {
			kind: 'cell';
			pointer: CanonicalGridCellPointer;
	  };

export function getProgrammaticScrollCellPointer(target: ProgrammaticScrollTarget | null): CanonicalGridCellPointer | null {
	return target?.kind === 'cell' ? target.pointer : null;
}
