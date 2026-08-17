import { describe, expect, it } from 'vitest';
import { createInfiniteBlockScopeId } from './asyncRowModelRequestIdentity.js';

describe('async row-model request identity helpers', () => {
	it('creates deterministic infinite block scope ids', () => {
		expect(createInfiniteBlockScopeId(0)).toBe('infinite:block:0');
		expect(createInfiniteBlockScopeId(7)).toBe('infinite:block:7');
		expect(createInfiniteBlockScopeId(7)).not.toBe(createInfiniteBlockScopeId(8));
	});
});
