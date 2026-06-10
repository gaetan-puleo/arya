import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { startDefinitionWatcher } from './watch';

describe('startDefinitionWatcher', () => {
  it('fires onChange (debounced) when a watched file is created', async () => {
    const dir = await Deno.makeTempDir();
    let calls = 0;
    const watcher = startDefinitionWatcher({ paths: [dir], onChange: () => void calls++, debounceMs: 50 });
    try {
      await Deno.writeTextFile(`${dir}/a.md`, 'x');
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(calls).toBeGreaterThanOrEqual(1);
    } finally {
      watcher.stop();
      await Deno.remove(dir, { recursive: true });
    }
  });

  it('skips non-existent paths without throwing', () => {
    const watcher = startDefinitionWatcher({ paths: ['/no/such/dir/xyz-arya'], onChange: () => {} });
    watcher.stop();
    expect(true).toBe(true);
  });
});
