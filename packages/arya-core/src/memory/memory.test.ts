import { expect, test } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENTRY_DELIMITER, MemoryStore } from './store';
import { createMemoryTools } from './tools';
import { createMemoryHook } from './hook';

async function tmpStore(): Promise<{ store: MemoryStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'arya-mem-'));
  return { store: new MemoryStore(dir), dir };
}

test('add + recall + list + remove (substring)', async () => {
  const { store, dir } = await tmpStore();
  try {
    expect(store.add('memory', 'User prefers dark mode').ok).toBe(true);
    expect(store.add('memory', 'Project uses pnpm').ok).toBe(true);
    expect(store.count('memory')).toBe(2);

    const hits = store.recall('dark');
    expect(hits.length).toBe(1);
    expect(hits[0].entry).toBe('User prefers dark mode');
    expect(hits[0].target).toBe('memory');

    expect(store.list('memory').length).toBe(2);
    expect(store.remove('memory', 'pnpm').ok).toBe(true);
    expect(store.remove('memory', 'pnpm').ok).toBe(false);
    expect(store.count('memory')).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('two targets are separate files', async () => {
  const { store, dir } = await tmpStore();
  try {
    store.add('memory', 'agent note');
    store.add('user', 'user is French');
    expect(store.list('memory')).toEqual(['agent note']);
    expect(store.list('user')).toEqual(['user is French']);
    const memoryFile = await readFile(join(dir, 'MEMORY.md'), 'utf-8');
    const userFile = await readFile(join(dir, 'USER.md'), 'utf-8');
    expect(memoryFile).toBe('agent note');
    expect(userFile).toBe('user is French');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('dedup on load: duplicate entries collapse', async () => {
  const { store, dir } = await tmpStore();
  try {
    store.add('memory', 'same fact');
    const dup = store.add('memory', 'same fact');
    expect(dup.ok).toBe(true);
    expect(dup.message).toContain('already exists');
    expect(store.count('memory')).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('char limit: overflow refuses the add and asks to consolidate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'arya-mem-'));
  try {
    const store = new MemoryStore(dir, { memoryCharLimit: 40 });
    expect(store.add('memory', 'first short entry').ok).toBe(true);
    const over = store.add('memory', 'this entry is definitely longer than the remaining budget');
    expect(over.ok).toBe(false);
    expect(over.message).toContain('Consolidate');
    expect(store.count('memory')).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('replace swaps the whole entry containing the substring', async () => {
  const { store, dir } = await tmpStore();
  try {
    store.add('memory', 'User prefers dark mode');
    const r = store.replace('memory', 'dark mode', 'User prefers light mode');
    expect(r.ok).toBe(true);
    expect(store.list('memory')).toEqual(['User prefers light mode']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ambiguous substring match is refused', async () => {
  const { store, dir } = await tmpStore();
  try {
    store.add('memory', 'alpha shared text one');
    store.add('memory', 'beta shared text two');
    const r = store.remove('memory', 'shared text');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Multiple entries matched');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('entries round-trip through the section-sign delimiter', async () => {
  const { store, dir } = await tmpStore();
  try {
    store.add('memory', 'line one');
    store.add('memory', 'line two');
    const raw = await readFile(join(dir, 'MEMORY.md'), 'utf-8');
    expect(raw).toBe(['line one', 'line two'].join(ENTRY_DELIMITER));
    expect(store.list('memory')).toEqual(['line one', 'line two']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('digest is bounded and empty when no memories', async () => {
  const { store, dir } = await tmpStore();
  try {
    expect(store.digest()).toBe('');
    store.add('memory', 'c'.repeat(100));
    store.add('user', 'd'.repeat(100));
    const d = store.digest(300);
    expect(d).toContain('## Memory');
    expect(d).toContain('ccc');
    expect(d).toContain('USER.md');
    expect(store.digest(10)).toBe('');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('memory tools drive the store', async () => {
  const { store, dir } = await tmpStore();
  try {
    const [save, recall, list, forget, replace] = createMemoryTools(store);
    expect(save.name).toBe('memory_save');
    expect(replace.name).toBe('memory_replace');

    const saved = await save.run({ content: 'loves pizza', target: 'user' }, {} as never);
    expect((saved[0] as { text: string }).text).toContain('Saved to user');

    const found = await recall.run({ query: 'pizza' }, {} as never);
    expect((found[0] as { text: string }).text).toContain('[user] loves pizza');

    const listed = await list.run({ target: 'user' }, {} as never);
    expect((listed[0] as { text: string }).text).toContain('loves pizza');

    const rep = await replace.run({ old_text: 'pizza', new_content: 'loves pasta', target: 'user' }, {} as never);
    expect((rep[0] as { text: string }).text).toContain('replaced');
    expect(store.list('user')).toEqual(['loves pasta']);

    const gone = await forget.run({ old_text: 'pasta', target: 'user' }, {} as never);
    expect((gone[0] as { text: string }).text).toContain('removed');
    expect(store.count('user')).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('memory hook injects digest + nudge into system', async () => {
  const { store, dir } = await tmpStore();
  try {
    store.add('user', 'User is French');
    const hook = createMemoryHook(store);
    const out = await hook.prepareRequest!({ system: 'BASE', tools: [] });
    const sys = out?.system ?? '';
    expect(sys).toContain('BASE');
    expect(sys).toContain('memory_save');
    expect(sys).toContain('User is French');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('memory hook with nudge disabled omits the nudge line', async () => {
  const { store, dir } = await tmpStore();
  try {
    const hook = createMemoryHook(store, { nudge: false });
    const out = await hook.prepareRequest!({ system: 'BASE', tools: [] });
    expect(out?.system).toBe('BASE');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
