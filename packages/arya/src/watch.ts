import { existsSync, mkdirSync } from 'node:fs';

export interface DefinitionWatcher {
  stop(): void;
}

export interface WatchOptions {
  paths: string[];
  onChange: () => void | Promise<void>;
  debounceMs?: number;
  log?: (message: string) => void;
}

export function startDefinitionWatcher(opts: WatchOptions): DefinitionWatcher {
  const { onChange, debounceMs = 200, log } = opts;
  // Ensure each dir exists so it's watchable — a definition created in a dir that
  // didn't exist at boot would otherwise only be picked up after a restart.
  const paths = [...new Set(opts.paths)].filter((p) => {
    try {
      mkdirSync(p, { recursive: true });
      return true;
    } catch {
      return existsSync(p);
    }
  });
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
