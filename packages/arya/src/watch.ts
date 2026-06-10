import { existsSync } from 'node:fs';

export interface DefinitionWatcher {
  stop(): void;
}

export interface WatchOptions {
  /** Directories to watch (recursively). Non-existent paths are skipped. */
  paths: string[];
  /** Called (debounced) whenever a watched file is created, edited, or removed. */
  onChange: () => void | Promise<void>;
  debounceMs?: number;
  log?: (message: string) => void;
}

/**
 * Watches the definition directories and fires {@link WatchOptions.onChange}
 * (debounced) on any create/edit/remove, so hot-reload can refresh the
 * registries/scheduler without a restart. Read-only ("access") events are
 * ignored; a missing path is skipped rather than throwing.
 */
export function startDefinitionWatcher(opts: WatchOptions): DefinitionWatcher {
  const { onChange, debounceMs = 200, log } = opts;
  const paths = [...new Set(opts.paths)].filter((p) => existsSync(p));
  if (paths.length === 0) return { stop: () => {} };

  const watcher = Deno.watchFs(paths, { recursive: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const fire = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      void Promise.resolve(onChange()).catch((err) =>
        log?.(`reload failed: ${err instanceof Error ? err.message : String(err)}`)
      );
    }, debounceMs);
  };

  void (async () => {
    try {
      for await (const event of watcher) {
        if (stopped) break;
        if (event.kind === 'access') continue;
        fire();
      }
    } catch (err) {
      if (!stopped) log?.(`watcher stopped: ${err instanceof Error ? err.message : String(err)}`);
    }
  })();

  log?.(`watching ${paths.length} definition dir(s) for changes`);
  return {
    stop: () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      try {
        watcher.close();
      } catch {
        // already closed
      }
    },
  };
}
