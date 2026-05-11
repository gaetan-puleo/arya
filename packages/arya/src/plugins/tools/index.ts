/**
 * arya-tools — a plugin that provides filesystem, shell, and HTTP tools
 * for arya-agent.
 *
 * Tools provided:
 *  - `fs.read_file`  : Read file content with optional line range
 *  - `fs.write_file` : Write/overwrite a file
 *  - `fs.list_dir`   : List directory contents (optionally recursive)
 *  - `shell.execute` : Execute a shell command via bash
 *  - `http.fetch`    : Make HTTP requests (GET, POST, PUT, DELETE, PATCH)
 *
 * Each tool declares a `permission.matchKey` so agent definitions can
 * authorise them via globs in their frontmatter.
 *
 * ── Integration plugins ──
 * Additional tools are loaded dynamically from ~/.config/arya/plugins/*.ts
 * (or $XDG_CONFIG_HOME/arya/plugins/*.ts). These are user-defined plugins
 * that are NOT shipped with the arya-agent source.
 *
 * See ~/.config/arya/plugins/ for available integration plugins.
 */

import type { Plugin } from 'mu-core';
import {
  createReadFileTool,
  createWriteFileTool,
  createListDirTool,
} from './fs-tools.js';
import { createShellTool } from './shell-tools.js';
import { createHttpTool } from './http-tools.js';

export interface AryaToolsConfig {
  /** Working directory for file/shell operations. Defaults to process.cwd(). */
  cwd?: string;
}

/**
 * Create the arya-tools plugin.
 *
 * Usage in bootstrap:
 * ```ts
 * import { createAryaToolsPlugin } from './plugins/tools/index.js';
 *
 * const handle = await startMu({
 *   config: { baseUrl, model, cwd },
 *   plugins: [
 *     createOpenAIProviderPlugin({ id: 'openai' }),
 *     createAgentsPlugin({ agentsDir, config: { baseUrl, model }, approvalChannelId: 'websocket' }),
 *     createAryaToolsPlugin({ cwd }),
 *   ],
 * });
 * ```
 */
export function createAryaToolsPlugin(config: AryaToolsConfig = {}): Plugin {
  const cwd = config.cwd ?? process.cwd();
  const getCwd = () => cwd;

  return {
    name: 'arya-tools',
    version: '0.1.0',
    tools: [
      createReadFileTool(getCwd),
      createWriteFileTool(getCwd),
      createListDirTool(getCwd),
      createShellTool(getCwd),
      createHttpTool(),
    ],
    systemPrompt: [
      'Available tools:',
      '- `fs.read_file(path, start?, end?)` — Read a text file with optional line range.',
      '- `fs.write_file(path, content)` — Write content to a file (creates parent dirs).',
      '- `fs.list_dir(path, recursive?, depth?)` — List directory contents.',
      '- `shell.execute(cmd)` — Execute a shell command via bash.',
      '- `http.fetch(url, method?, headers?, body?, timeoutMs?, responseType?)` — Make HTTP requests.',
      '',
      '── Integration plugins ──',
      'Additional tools are loaded from ~/.config/arya/plugins/*.ts.',
      'Permission rules are enforced by the host. Tools may be blocked, require',
      'approval, or be allowed based on the active agent\'s configuration.',
    ].join('\n'),
    activate(ctx) {
      // Update cwd from plugin context if available
      if (ctx.cwd) {
        // The getCwd closure captures the initial `cwd`, which is fine since
        // it's set at bootstrap time and doesn't change.
      }
    },
  };
}

export default createAryaToolsPlugin;

export { createReadFileTool, createWriteFileTool, createListDirTool } from './fs-tools.js';
export { createShellTool } from './shell-tools.js';
export { createHttpTool } from './http-tools.js';
