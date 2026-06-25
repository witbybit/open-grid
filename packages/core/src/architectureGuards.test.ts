/**
 * Architecture guard tests for the new Plan 133 kernel-based architecture.
 * Only invariants that survive Stage 5 deletion are kept.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const CORE_ROOT = resolve(__dirname, '..');
const REACT_ROOT = resolve(__dirname, '../../../packages/react');

describe('Architecture guardrails', () => {
  it('workspace and packages use an explicit alpha pre-release version', () => {
    const ws = JSON.parse(readFileSync(resolve(CORE_ROOT, '../../package.json'), 'utf-8')) as { version: string };
    const core = JSON.parse(readFileSync(resolve(CORE_ROOT, 'package.json'), 'utf-8')) as { version: string };
    const react = JSON.parse(readFileSync(resolve(REACT_ROOT, 'package.json'), 'utf-8')) as { version: string };
    expect(ws.version).toMatch(/^0\.\d+\.\d+-alpha\.\d+$/);
    expect(core.version).toMatch(/^0\.\d+\.\d+-alpha\.\d+$/);
    expect(react.version).toMatch(/^0\.\d+\.\d+-alpha\.\d+$/);
  });

  it('production source files do not contain Plan NNN or Phase N roadmap-chronology comments', () => {
    const srcDir = resolve(CORE_ROOT, 'src');
    const pattern = /\(Plan \d+|\bPhase \d+[:\s—]|\(Phase \d+\)/;
    const violations: string[] = [];
    function scan(dir: string): void {
      for (const entry of require('fs').readdirSync(dir)) {
        const abs = resolve(dir, entry);
        const stat = require('fs').statSync(abs);
        if (stat.isDirectory()) { scan(abs); continue; }
        if (/\.(tsx?|jsx?)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
          const content = readFileSync(abs, 'utf-8');
          if (pattern.test(content)) violations.push(abs.replace(srcDir + '\\', '').replace(srcDir + '/', ''));
        }
      }
    }
    scan(srcDir);
    expect(violations, `Production files with roadmap-chronology comments: ${violations.join(', ')}`).toHaveLength(0);
  });

  it('core package does not import from @open-grid/react', () => {
    const srcDir = resolve(CORE_ROOT, 'src');
    const reactImportPattern = /(?:from\s+|require\s*\(\s*)['"]@open-grid\/react['"]/;
    const violations: string[] = [];
    function scan(dir: string): void {
      for (const entry of require('fs').readdirSync(dir)) {
        const abs = resolve(dir, entry);
        const stat = require('fs').statSync(abs);
        if (stat.isDirectory()) { scan(abs); continue; }
        if (/\.(tsx?|jsx?)$/.test(entry) && !entry.endsWith('.test.ts')) {
          const content = readFileSync(abs, 'utf-8');
          if (reactImportPattern.test(content)) violations.push(abs);
        }
      }
    }
    scan(srcDir);
    expect(violations, `core files importing react: ${violations.join(', ')}`).toHaveLength(0);
  });

  it('kernel/ and domains/ do not import React', () => {
    const srcDir = resolve(CORE_ROOT, 'src');
    const reactPattern = /from ['"]react['"/]|require\(['"]react['"]/;
    const violations: string[] = [];
    for (const dir of ['kernel', 'domains']) {
      const dirPath = resolve(srcDir, dir);
      if (!existsSync(dirPath)) continue;
      function scan(d: string): void {
        for (const entry of require('fs').readdirSync(d)) {
          const abs = resolve(d, entry);
          const stat = require('fs').statSync(abs);
          if (stat.isDirectory()) { scan(abs); continue; }
          if (/\.(tsx?|jsx?)$/.test(entry) && !entry.endsWith('.test.ts')) {
            const content = readFileSync(abs, 'utf-8');
            if (reactPattern.test(content)) violations.push(abs);
          }
        }
      }
      scan(dirPath);
    }
    expect(violations, `kernel/domains importing React: ${violations.join(', ')}`).toHaveLength(0);
  });

  it('only GridScheduler (and optionally DomGridRenderer) use requestAnimationFrame in new-tree code', () => {
    const srcDir = resolve(CORE_ROOT, 'src');
    const newDirs = [resolve(srcDir, 'kernel'), resolve(srcDir, 'domains'), resolve(srcDir, 'api')];
    const rafPattern = /\brequestAnimationFrame\b/;
    const found: string[] = [];
    for (const root of newDirs) {
      if (!existsSync(root)) continue;
      function scan(d: string): void {
        for (const entry of require('fs').readdirSync(d)) {
          const abs = resolve(d, entry);
          const stat = require('fs').statSync(abs);
          if (stat.isDirectory()) { scan(abs); continue; }
          if (/\.(tsx?|jsx?)$/.test(entry) && !entry.endsWith('.test.ts')) {
            const content = readFileSync(abs, 'utf-8');
            if (rafPattern.test(content)) found.push(abs.replace(srcDir + '\\', '').replace(srcDir + '/', ''));
          }
        }
      }
      scan(root);
    }
    const normalized = found.map(p => p.replace(/\\/g, '/'));
    // GridScheduler is the RAF timing abstraction layer — it is the canonical and expected
    // place for requestAnimationFrame calls. DomGridRenderer delegates to GridScheduler and
    // must NOT call requestAnimationFrame directly. No other new-tree file should use RAF.
    const allowed = new Set(['domains/render/GridScheduler.ts', 'domains/render/DomGridRenderer.ts']);
    const unexpected = normalized.filter(p => !allowed.has(p));
    expect(unexpected, `unexpected RAF users: ${unexpected.join(', ')}`).toHaveLength(0);
    expect(normalized).toContain('domains/render/GridScheduler.ts');
  });

  it('index.ts does not re-export renderer-internal types', () => {
    const content = readFileSync(resolve(CORE_ROOT, 'src', 'index.ts'), 'utf-8');
    for (const t of ['RenderEngine', 'ViewportRenderer', 'RowRenderer', 'CellRenderer', 'PortalMountManager', 'RowSlot', 'CellSlot']) {
      expect(content, `index.ts must not export ${t}`).not.toContain(t);
    }
  });

  it('core package.json exports experimental and next subpaths', () => {
    const pkg = JSON.parse(readFileSync(resolve(CORE_ROOT, 'package.json'), 'utf-8')) as {
      exports?: Record<string, { types?: string; import?: string }>;
    };
    expect(pkg.exports?.['./experimental']).toBeTruthy();
    expect(pkg.exports?.['./next']).toBeTruthy();
  });

  it('styles.ts exists and contains og-cell-diff-changed CSS', () => {
    const content = readFileSync(resolve(CORE_ROOT, 'src', 'renderer', 'styles.ts'), 'utf-8');
    expect(content).toContain('.og-cell-diff-changed');
  });
});
