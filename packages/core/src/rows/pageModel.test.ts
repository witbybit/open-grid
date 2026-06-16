import { describe, expect, it } from 'vitest';
import { computePageWindow } from './pageModel.js';

describe('computePageWindow', () => {
	it('computes a full first page', () => {
		expect(computePageWindow(250, 100, 0)).toEqual({ page: 0, pageSize: 100, startIndex: 0, endIndex: 100, pageCount: 3, totalRows: 250 });
	});

	it('computes a middle page', () => {
		expect(computePageWindow(250, 100, 1)).toMatchObject({ page: 1, startIndex: 100, endIndex: 200, pageCount: 3 });
	});

	it('computes a partial last page', () => {
		expect(computePageWindow(250, 100, 2)).toMatchObject({ page: 2, startIndex: 200, endIndex: 250, pageCount: 3 });
	});

	it('clamps an out-of-range page down to the last page', () => {
		expect(computePageWindow(250, 100, 99)).toMatchObject({ page: 2, startIndex: 200, endIndex: 250 });
	});

	it('clamps a negative page up to 0', () => {
		expect(computePageWindow(250, 100, -5)).toMatchObject({ page: 0, startIndex: 0, endIndex: 100 });
	});

	it('treats an empty grid as page 1 of 1 with an empty slice', () => {
		expect(computePageWindow(0, 100, 0)).toEqual({ page: 0, pageSize: 100, startIndex: 0, endIndex: 0, pageCount: 1, totalRows: 0 });
	});

	it('handles a single full page (total divides evenly)', () => {
		expect(computePageWindow(100, 100, 0)).toMatchObject({ pageCount: 1, startIndex: 0, endIndex: 100 });
	});

	it('floors a fractional/zero page size to at least 1', () => {
		expect(computePageWindow(5, 0, 0)).toMatchObject({ pageSize: 1, pageCount: 5, startIndex: 0, endIndex: 1 });
	});

	it('handles total smaller than page size', () => {
		expect(computePageWindow(7, 100, 0)).toMatchObject({ pageCount: 1, startIndex: 0, endIndex: 7 });
	});
});
