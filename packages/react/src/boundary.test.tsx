import { describe, expect, it } from 'vitest';
import * as publicApi from './index.js';
import * as experimentalApi from './experimental.js';

describe('React public boundary', () => {
  it('keeps GridNext as the grid entrypoint', () => {
    expect(typeof (publicApi as Record<string, unknown>)['GridNext']).toBe('function');
  });

  it('does not export old Grid component', () => {
    expect((publicApi as Record<string, unknown>)['Grid']).toBeUndefined();
    expect((publicApi as Record<string, unknown>)['GridView']).toBeUndefined();
    expect((publicApi as Record<string, unknown>)['useGridApi']).toBeUndefined();
  });

  it('exports theme utilities', () => {
    expect(typeof (publicApi as Record<string, unknown>)['createTheme']).toBe('function');
    expect(typeof (publicApi as Record<string, unknown>)['BUILT_IN_THEMES']).toBe('object');
  });

  it('experimental entry is empty during Stage 5 migration', () => {
    expect(Object.keys(experimentalApi)).toHaveLength(0);
  });
});
