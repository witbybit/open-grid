import { describe, it, expect } from 'vitest';
import * as publicApi from './index.js';

describe('Public boundary (@open-grid/core)', () => {
  it('exports createGrid', () => {
    expect(typeof (publicApi as Record<string, unknown>)['createGrid']).toBe('function');
  });

  it('exports DomGridRenderer', () => {
    expect(typeof (publicApi as Record<string, unknown>)['DomGridRenderer']).toBe('function');
  });

  it('exports theme utilities', () => {
    expect(typeof (publicApi as Record<string, unknown>)['createTheme']).toBe('function');
    expect(typeof (publicApi as Record<string, unknown>)['BUILT_IN_THEMES']).toBe('object');
  });

  it('does not export GridStore or GridEngine', () => {
    expect((publicApi as Record<string, unknown>)['GridStore']).toBeUndefined();
    expect((publicApi as Record<string, unknown>)['GridEngine']).toBeUndefined();
  });
});
