/**
 * trvl (travel) tools — AI Travel Agent via MCP.
 *
 * Connects to the `trvl` binary as an MCP server (stdio transport) and exposes
 * all travel tools: flights, hotels, trains, buses, ferries, price alerts, etc.
 *
 * Prerequisites:
 * 1. Install trvl binary: https://github.com/MikkoParkkola/trvl
 *    brew install MikkoParkkola/tap/trvl
 * 2. Install MCP client: bun add @modelcontextprotocol/client
 *
 * Requires TRVL_BIN environment variable (default: "trvl").
 */

import { Client, StdioClientTransport } from '@modelcontextprotocol/client';
import type { PluginTool } from 'mu-core';

interface TrvlConnection {
  client: Client;
  transport: StdioClientTransport;
}

let connection: TrvlConnection | null = null;

async function getConnection(): Promise<TrvlConnection> {
  if (connection) return connection;

  const bin = process.env.TRVL_BIN || 'trvl';
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }

  const transport = new StdioClientTransport({
    command: bin,
    args: ['mcp'],
    env,
    stderr: 'pipe',
  });

  const client = new Client({
    name: 'arya',
    version: '0.1.0',
  });

  await client.connect(transport);
  connection = { client, transport };
  return connection;
}

async function closeConnection(): Promise<void> {
  if (connection) {
    await connection.client.close();
    await connection.transport.close();
    connection = null;
  }
}

export function createTrvlDefaultTool(): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'trvl',
        description:
          'Travel tools powered by trvl MCP server (flights, hotels, trains, buses, ferries, price tracking, travel hacks). Requires trvl binary installed.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    },
    permission: { matchKey: () => undefined },
    async execute() {
      try {
        const conn = await getConnection();
        const { tools } = await conn.client.listTools();
        const names = tools.map((t) => t.name).join(', ');
        return `trvl MCP bridge active — ${tools.length} tools available: ${names}`;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `trvl error: ${msg}. Install trvl: https://github.com/MikkoParkkola/trvl`;
      }
    },
  };
}

/**
 * Dynamically create trvl MCP tools at runtime.
 * Called by the plugin system to inject MCP tools into the tool registry.
 */
export async function createTrvlMcpTools(): Promise<PluginTool[]> {
  try {
    const conn = await getConnection();
    const { tools: mcpTools } = await conn.client.listTools();
    const prefix = 'trvl';

    return mcpTools.map((mcpTool) => {
      const name = `${prefix}__${mcpTool.name}`;
      return {
        definition: {
          type: 'function',
          function: {
            name,
            description: mcpTool.description || `MCP tool: ${mcpTool.name}`,
            parameters: (mcpTool.inputSchema ?? { type: 'object', properties: {}, additionalProperties: false }) as Record<string, unknown>,
          },
        },
        permission: { matchKey: () => undefined },
        async execute(args: Record<string, unknown>) {
          const result = await conn.client.callTool({
            name: mcpTool.name,
            arguments: args,
          });

          const textParts = (result.content as Array<{ type: string; text?: string }>)
            .filter((c) => c.type === 'text' && c.text)
            .map((c) => c.text as string);

          const text = textParts.join('\n') || JSON.stringify(result.content);

          if ((result as { isError?: boolean }).isError) {
            return { content: `[MCP error] ${text}`, error: true };
          }
          return { content: text };
        },
      } as PluginTool;
    });
  } catch {
    return [];
  }
}

export { closeConnection };
