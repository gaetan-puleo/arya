import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startDefinitionWatcher } from './watch';

describe('startDefinitionWatcher', () => {
  it('fires onChange (debounced) when a watched file is created', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arya-test-'));
    let calls = 0;
    const watcher = startDefinitionWatcher({ paths: [dir], onChange: () => void calls++, debounceMs: 50 });
    try {
      await writeFile(`${dir}/a.md`, 'x');
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(calls).toBeGreaterThanOrEqual(1);
    } finally {
      watcher.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('skips non-existent paths without throwing', () => {
    const watcher = startDefinitionWatcher({ paths: ['/no/such/dir/xyz-arya'], onChange: () => {} });
    watcher.stop();
    expect(true).toBe(true);
  });
});
