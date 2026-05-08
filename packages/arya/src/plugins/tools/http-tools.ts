/**
 * HTTP tool for arya-agent — makes HTTP requests (GET, POST, PUT, DELETE).
 */

import type { PluginTool } from 'mu-core';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5 MB

export function createHttpTool(): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'http.fetch',
        description:
          'Make an HTTP request (GET, POST, PUT, DELETE, PATCH). Returns status, headers, and body as text or JSON.',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The full URL to request (must start with http:// or https://).',
            },
            method: {
              type: 'string',
              description: 'HTTP method (GET, POST, PUT, DELETE, PATCH). Defaults to GET.',
              enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
            },
            headers: {
              type: 'object',
              description: 'Optional headers as key-value pairs.',
              additionalProperties: { type: 'string' },
            },
            body: {
              type: 'string',
              description: 'Request body (for POST/PUT/PATCH).',
            },
            timeoutMs: {
              type: 'integer',
              description: 'Request timeout in milliseconds. Defaults to 30000.',
            },
            responseType: {
              type: 'string',
              description: 'Response format: "text" (default) or "json".',
              enum: ['text', 'json'],
            },
          },
          required: ['url'],
          additionalProperties: false,
        },
      },
    },
    display: {
      verb: 'fetching',
      kind: 'http',
      fields: { url: 'url' },
    },
    permission: {
      matchKey: (args) => (args.url as string) ?? undefined,
    },
    async execute(args) {
      const url = args.url as string;
      const method = (args.method as string) ?? 'GET';
      const headers = (args.headers as Record<string, string>) ?? {};
      const body = args.body as string | undefined;
      const timeoutMs = (args.timeoutMs as number) ?? DEFAULT_TIMEOUT_MS;
      const responseType = (args.responseType as 'text' | 'json') ?? 'text';

      // Validate URL
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return { content: `Error: URL must start with http:// or https://`, error: true };
      }

      // Validate method
      const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
      if (!validMethods.includes(method.toUpperCase())) {
        return { content: `Error: Invalid HTTP method: ${method}`, error: true };
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const fetchInit: RequestInit = {
          method: method.toUpperCase(),
          signal: controller.signal,
          headers: {
            'User-Agent': 'arya-agent/0.1.0',
            ...headers,
          },
        };

        if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
          fetchInit.body = body;
          if (!headers['Content-Type']) {
            (fetchInit.headers as Record<string, string>)['Content-Type'] = 'application/json';
          }
        }

        const response = await fetch(url, fetchInit);
        clearTimeout(timeoutId);

        // Read response with size limit
        const reader = response.body?.getReader();
        if (!reader) {
          return {
            content: `Status: ${response.status} ${response.statusText}\nHeaders: ${formatHeaders(response.headers)}`,
          };
        }

        const chunks: Uint8Array[] = [];
        let totalSize = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          totalSize += value.length;
          if (totalSize > MAX_RESPONSE_SIZE) {
            return {
              content: `Error: Response exceeded maximum size of ${MAX_RESPONSE_SIZE / 1024 / 1024} MB`,
              error: true,
            };
          }

          chunks.push(value);
        }

        const bodyBuffer = new Uint8Array(chunks.reduce((acc, chunk) => {
          const newBuf = new Uint8Array(acc.length + chunk.length);
          newBuf.set(acc);
          newBuf.set(chunk, acc.length);
          return newBuf;
        }, new Uint8Array(0)));
        const bodyText = new TextDecoder().decode(bodyBuffer);

        let formattedBody = bodyText;
        if (responseType === 'json') {
          try {
            formattedBody = JSON.stringify(JSON.parse(bodyText), null, 2);
          } catch {
            formattedBody = bodyText; // Not valid JSON, return as-is
          }
        }

        return {
          content: [
            `Status: ${response.status} ${response.statusText}`,
            `Headers: ${formatHeaders(response.headers)}`,
            `Body (${bodyText.length} chars):`,
            formattedBody,
          ].join('\n'),
          error: response.status >= 400,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Error making HTTP request: ${msg}`, error: true };
      }
    },
  };
}

function formatHeaders(headers: Headers): string {
  const parts: string[] = [];
  headers.forEach((value, key) => {
    parts.push(`${key}: ${value}`);
  });
  return parts.join(', ');
}
