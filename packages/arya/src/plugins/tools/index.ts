/**
 * arya-http-tools — bundles arya's HTTP tool (`http.fetch`).
 *
 * The filesystem + shell tools (`read`, `write`, `edit`, `bash`, `list_dir`)
 * live in the shared `mu-tools` package and are added to the plugin list
 * separately by `bootstrap`.
 */

import type { Plugin } from 'mu-core';
import { createHttpTool } from './http-tools.js';

export interface AryaHttpToolsConfig {
  /** Currently unused — placeholder for future per-host knobs. */
  cwd?: string;
}

export function createAryaHttpToolsPlugin(_config: AryaHttpToolsConfig = {}): Plugin {
  return {
    name: 'arya-http-tools',
    version: '0.1.0',
    tools: [createHttpTool()],
    systemPrompt: [
      'HTTP tool:',
      '- `http.fetch(url, method?, headers?, body?, timeoutMs?, responseType?)` — Make HTTP requests.',
      '',
      'Permission rules are enforced by the host. Tools may be blocked, require',
      "approval, or be allowed based on the active agent's configuration.",
    ].join('\n'),
  };
}


