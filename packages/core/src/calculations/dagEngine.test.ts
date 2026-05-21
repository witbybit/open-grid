import { describe, it, expect, vi } from 'vitest';
import { DagEngine } from './dagEngine.js';

describe('DagEngine Formula calculations', () => {
	it('should resolve direct references and evaluate basic arithmetic', () => {
		const engine = new DagEngine();
		const storeValues: Record<string, any> = {
			'R1:price': 40,
		};
		const getRawValue = (rId: string, cField: string) => storeValues[`${rId}:${cField}`];

		// Register: R2:subtotal = [R1:price] * 2
		engine.registerFormula('R2', 'subtotal', '=[R1:price] * 2');

		const val = engine.getCellValue('R2', 'subtotal', getRawValue);
		expect(val).toBe(80);
	});

	it('should evaluate formulas lazily and preserve cache on subsequent calls', () => {
		const engine = new DagEngine();
		const storeValues: Record<string, any> = {
			'R1:value': 10,
		};
		const getRawValueSpy = vi.fn((rId: string, cField: string) => storeValues[`${rId}:${cField}`]);

		engine.registerFormula('R2', 'subtotal', '=[R1:value] + 15');

		// First fetch: triggers evaluation
		const val1 = engine.getCellValue('R2', 'subtotal', getRawValueSpy);
		expect(val1).toBe(25);
		expect(getRawValueSpy).toHaveBeenCalledTimes(1);

		// Second fetch: should hit lazy cache
		const val2 = engine.getCellValue('R2', 'subtotal', getRawValueSpy);
		expect(val2).toBe(25);
		expect(getRawValueSpy).toHaveBeenCalledTimes(1); // Still 1!
	});

	it('should recursively evaluate multi-depth dependency hierarchies', () => {
		const engine = new DagEngine();
		const storeValues: Record<string, any> = {
			'A1:value': 5,
		};
		const getRawValue = (rId: string, cField: string) => storeValues[`${rId}:${cField}`];

		// B1 = A1 * 2   (10)
		engine.registerFormula('B1', 'value', '=[A1:value] * 2');
		// C1 = B1 + 30  (40)
		engine.registerFormula('C1', 'value', '=[B1:value] + 30');

		expect(engine.getCellValue('C1', 'value', getRawValue)).toBe(40);
	});

	it('should recursively propagate dirty state when dependency sources are updated', () => {
		const engine = new DagEngine();
		const storeValues: Record<string, any> = {
			'A1:value': 5,
		};
		const getRawValue = (rId: string, cField: string) => storeValues[`${rId}:${cField}`];

		// B1 = A1 * 2   (10)
		engine.registerFormula('B1', 'value', '=[A1:value] * 2');
		// C1 = B1 + 10  (20)
		engine.registerFormula('C1', 'value', '=[B1:value] + 10');

		expect(engine.getCellValue('C1', 'value', getRawValue)).toBe(20);

		// Act: Update source value A1
		storeValues['A1:value'] = 10;
		engine.invalidateCell('A1', 'value');

		// Assert: C1 should recalculate to (10 * 2) + 10 = 30
		expect(engine.getCellValue('C1', 'value', getRawValue)).toBe(30);
	});

	it('should prevent circular dependencies by throwing an validation error upon formula registration', () => {
		const engine = new DagEngine();

		// B1 depends on A1
		engine.registerFormula('B1', 'value', '=[A1:value] + 5');

		// Act & Assert: Registering A1 to depend on B1 should trigger cycle detection block
		expect(() => {
			engine.registerFormula('A1', 'value', '=[B1:value] + 10');
		}).toThrowError(/Circular dependency/);
	});

	it('should evaluate common spreadsheet functions like SUM, AVERAGE, MIN, and MAX', () => {
		const engine = new DagEngine();
		const storeValues: Record<string, any> = {
			'R1:val': 10,
			'R2:val': 20,
			'R3:val': 30,
		};
		const getRawValue = (rId: string, cField: string) => storeValues[`${rId}:${cField}`];

		engine.registerFormula('Total', 'sum', '=SUM([R1:val], [R2:val], [R3:val], 40)');
		engine.registerFormula('Total', 'avg', '=AVERAGE([R1:val], [R2:val], [R3:val])');
		engine.registerFormula('Total', 'min', '=MIN([R1:val], [R2:val], [R3:val])');
		engine.registerFormula('Total', 'max', '=MAX([R1:val], [R2:val], [R3:val])');

		expect(engine.getCellValue('Total', 'sum', getRawValue)).toBe(100); // 10 + 20 + 30 + 40
		expect(engine.getCellValue('Total', 'avg', getRawValue)).toBe(20); // (10 + 20 + 30)/3
		expect(engine.getCellValue('Total', 'min', getRawValue)).toBe(10);
		expect(engine.getCellValue('Total', 'max', getRawValue)).toBe(30);
	});
});
