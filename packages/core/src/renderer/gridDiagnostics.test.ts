import { describe, it, expect } from 'vitest';
import { NoopDiagnostics, ActiveDiagnostics, createDiagnostics } from './gridDiagnostics.js';

describe('NoopDiagnostics', () => {
	it('is disabled', () => {
		expect(new NoopDiagnostics().enabled).toBe(false);
	});

	it('snapshot() returns empty object', () => {
		const d = new NoopDiagnostics();
		d.increment('foo', 5);
		d.timing('bar', 10);
		expect(d.snapshot()).toEqual({});
	});

	it('reset() is a no-op', () => {
		const d = new NoopDiagnostics();
		expect(() => d.reset()).not.toThrow();
	});
});

describe('ActiveDiagnostics', () => {
	it('is enabled', () => {
		expect(new ActiveDiagnostics().enabled).toBe(true);
	});

	it('increment() accumulates counter', () => {
		const d = new ActiveDiagnostics();
		d.increment('renders');
		d.increment('renders', 3);
		expect(d.snapshot()).toEqual({ renders: 4 });
	});

	it('timing() accumulates under <label>_ms key', () => {
		const d = new ActiveDiagnostics();
		d.timing('paint', 12);
		d.timing('paint', 8);
		expect(d.snapshot()).toEqual({ paint_ms: 20 });
	});

	it('snapshot() returns a defensive copy', () => {
		const d = new ActiveDiagnostics();
		d.increment('x');
		const snap = d.snapshot();
		snap['x'] = 999;
		expect(d.snapshot()['x']).toBe(1);
	});

	it('reset() clears all counters', () => {
		const d = new ActiveDiagnostics();
		d.increment('a', 10);
		d.timing('b', 5);
		d.reset();
		expect(d.snapshot()).toEqual({});
	});
});

describe('createDiagnostics()', () => {
	it('returns NoopDiagnostics when disabled (default)', () => {
		expect(createDiagnostics().enabled).toBe(false);
	});

	it('returns ActiveDiagnostics when enabled', () => {
		expect(createDiagnostics(true).enabled).toBe(true);
	});
});
