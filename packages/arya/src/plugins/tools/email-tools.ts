/**
 * Email (IMAP) tools — powered by imapflow.
 *
 * Tools:
 *  - email-search          : List or search emails
 *  - email-read            : Read full content of an email by UID
 *  - email-tag             : Add or remove flags on emails
 *  - email-move            : Move emails to another folder
 *  - email-list-folders    : List all IMAP folders/mailboxes
 *  - email-create-folder   : Create a new IMAP folder
 *  - email-list-accounts   : List all configured email accounts
 *
 * Requires IMAP_1_HOST, IMAP_1_PORT, IMAP_1_USER, IMAP_1_PASS env vars.
 * Supports multiple accounts: IMAP_2_*, IMAP_3_*, etc.
 */

import { ImapFlow } from 'imapflow';
import type { PluginTool } from 'mu-core';

interface AccountConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  mailbox: string;
}

function getAccountConfig(n: number): AccountConfig {
  const prefix = `${n}_`;
  const env = (key: string) => {
    const v = process.env[`IMAP_${prefix}${key}`]?.trim();
    if (!v) throw new Error(`Missing IMAP_${prefix}${key} environment variable`);
    return v;
  };
  const port = Number(env('PORT')) || 993;
  return { host: env('HOST'), port, user: env('USER'), pass: env('PASS'), mailbox: env('MAILBOX') || 'INBOX' };
}

function listAvailableAccounts(): { id: string; user: string; host: string }[] {
  const accounts: { id: string; user: string; host: string }[] = [];
  let n = 1;
  while (process.env[`IMAP_${n}_HOST`]?.trim()) {
    accounts.push({
      id: String(n),
      user: process.env[`IMAP_${n}_USER`]?.trim() || '?',
      host: process.env[`IMAP_${n}_HOST`]?.trim() || '?',
    });
    n++;
  }
  return accounts;
}

function createClient(config: AccountConfig): ImapFlow {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.port !== 143,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });
}

async function withClient<T>(config: AccountConfig, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const client = createClient(config);
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

async function withMailbox<T>(config: AccountConfig, path: string, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(path);
    try {
      return await fn(client);
    } finally {
      lock.release();
    }
  });
}

interface Msg {
  uid: number;
  flags: Set<string>;
  envelope: {
    date?: Date;
    subject?: string;
    from?: { name?: string; address?: string }[];
    to?: { name?: string; address?: string }[];
  };
  bodyStructure?: {
    childNodes?: { part?: string; type?: string }[];
    type?: string;
    part?: string;
  };
}

function fmtAddr(list?: { name?: string; address?: string }[], all = false): string {
  if (!list?.length) return '?';
  if (!all) return list[0].name || list[0].address || '?';
  return list.map((a) => a.address || a.name || '?').join(', ');
}

function fmtDate(d?: Date): string {
  return d ? d.toLocaleDateString('en-US', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) : '?';
}

function fmtFlags(flags: Set<string>): string {
  const map: Record<string, string> = {
    '\\Seen': 'read', '\\Flagged': '⚑', '\\Answered': '↩', '\\Draft': 'draft',
  };
  const out = [...flags].map((f) => f.startsWith('\\') ? (map[f] ?? null) : f).filter(Boolean) as string[];
  return out.join(', ') || '-';
}

function trunc(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function csv(s: string): string[] {
  return s.split(',').map((v) => v.trim()).filter(Boolean);
}

const FLAG_ALIASES: Record<string, string> = {
  seen: '\\Seen', read: '\\Seen', flagged: '\\Flagged', important: '\\Flagged',
  answered: '\\Answered', draft: '\\Draft', deleted: '\\Deleted',
};

async function downloadTextPart(client: ImapFlow, uid: number, bodyStructure?: Msg['bodyStructure']): Promise<string> {
  let part: string | undefined;
  function find(node?: { part?: string; type?: string; childNodes?: { part?: string; type?: string }[] }): string | undefined {
    if (!node) return undefined;
    if (node.type?.startsWith('text/plain') && node.part) return node.part;
    if (node.type?.startsWith('text/html') && node.part) return node.part;
    for (const child of node.childNodes ?? []) {
      const found = find(child);
      if (found) return found;
    }
    return undefined;
  }
  part = find(bodyStructure);
  const { content } = await client.download(String(uid), part, { uid: true });
  const chunks: Buffer[] = [];
  for await (const chunk of content) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf-8');
  if (!text.trim()) return '(empty body)';
  return trunc(text.trim(), 5000);
}

export function createEmailSearchTool(): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'email-search',
        description: 'List or search emails. No criteria → latest N emails. With criteria → filter by sender, subject, date, body, flags.',
        parameters: {
          type: 'object',
          properties: {
            account: { type: 'string', description: 'Account index (e.g., "1", "2")' },
            mailbox: { type: 'string', description: 'IMAP folder (default: account default)' },
            from: { type: 'string', description: 'Sender (contains)' },
            to: { type: 'string', description: 'Recipient (contains)' },
            subject: { type: 'string', description: 'Subject (contains)' },
            body: { type: 'string', description: 'Body content' },
            since: { type: 'string', description: 'Since (YYYY-MM-DD)' },
            before: { type: 'string', description: 'Before (YYYY-MM-DD)' },
            flagged: { type: 'boolean', description: 'Flagged emails only' },
            unseen: { type: 'boolean', description: 'Unread emails only' },
            count: { type: 'integer', description: 'Max results (default: 20, max: 50)' },
          },
          required: ['account'],
          additionalProperties: false,
        },
      },
    },
    permission: { matchKey: () => undefined },
    async execute(args) {
      const a = args as Record<string, unknown>;
      const n = parseInt(String(a.account), 10);
      if (Number.isNaN(n) || n < 1) return { content: `Invalid account ID: "${a.account}". Must be a positive integer.`, error: true };
      const config = getAccountConfig(n);
      const folder = (a.mailbox as string) || config.mailbox;
      const limit = Math.min(Math.max((a.count as number) ?? 20, 1), 50);

      const q: Record<string, unknown> = {};
      for (const k of ['from', 'to', 'subject', 'body'] as const)
        if (a[k]) q[k] = a[k];
      if (a.since) q.since = new Date(a.since as string);
      if (a.before) q.before = new Date(a.before as string);
      if (a.flagged === true) q.flagged = true;
      if (a.unseen === true) q.seen = false;
      const hasQuery = Object.keys(q).length > 0;

      return withMailbox(config, folder, async (client) => {
        if (!hasQuery) {
          const total = client.mailbox ? client.mailbox.exists : 0;
          if (!total) return `Folder "${folder}" is empty.`;
          const msgs = (await client.fetchAll(`${Math.max(1, total - limit + 1)}:*`, { envelope: true, flags: true, size: true })) as unknown as Msg[];
          if (!msgs.length) return `Folder "${folder}" is empty.`;
          const sorted = [...msgs].sort((a, b) => (b.envelope.date?.getTime() ?? 0) - (a.envelope.date?.getTime() ?? 0));
          return formatEmailTable(sorted);
        }
        const result = await client.search(q, { uid: true });
        const uids = Array.isArray(result) ? result : [];
        if (!uids.length) return `No results in "${folder}".`;
        const msgs = (await client.fetchAll(uids.slice(-limit).join(','), { envelope: true, flags: true, size: true }, { uid: true })) as unknown as Msg[];
        return formatEmailTable(msgs);
      });
    },
  };
}

function formatEmailTable(msgs: Msg[]): string {
  if (!msgs.length) return 'No emails found.';
  const sorted = [...msgs].sort((a, b) => (b.envelope.date?.getTime() ?? 0) - (a.envelope.date?.getTime() ?? 0));
  const lines = [
    '| UID | Date | From | Subject | Flags |',
    '|-----|------|------|---------|-------|',
    ...sorted.map((m) => `| ${m.uid} | ${fmtDate(m.envelope.date)} | ${trunc(fmtAddr(m.envelope.from), 30)} | ${trunc(m.envelope.subject ?? '(no subject)', 50)} | ${fmtFlags(m.flags)} |`),
    '',
    `Total: ${sorted.length} email(s)`,
  ];
  return lines.join('\n');
}

export function createEmailReadTool(): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'email-read',
        description: 'Read the full content of an email by its UID.',
        parameters: {
          type: 'object',
          properties: {
            account: { type: 'string', description: 'Account index (e.g., "1", "2")' },
            mailbox: { type: 'string', description: 'IMAP folder (default: account default)' },
            uid: { type: 'string', description: 'Message UID' },
          },
          required: ['account', 'uid'],
          additionalProperties: false,
        },
      },
    },
    permission: { matchKey: () => undefined },
    async execute(args) {
      const { account, mailbox, uid } = args as { account: string; mailbox?: string; uid: string };
      const n = parseInt(account, 10);
      if (Number.isNaN(n) || n < 1) return { content: `Invalid account ID: "${account}".`, error: true };
      const config = getAccountConfig(n);
      const folder = mailbox || config.mailbox;
      const id = Number(uid);
      if (Number.isNaN(id)) return { content: 'Invalid UID', error: true };

      return withMailbox(config, folder, async (client) => {
        const m = (await client.fetchOne(String(id), { envelope: true, flags: true, bodyStructure: true }, { uid: true })) as
          | (Msg & { bodyStructure?: { childNodes?: { part?: string; type?: string }[]; type?: string; part?: string } })
          | false;
        if (!m) return `No email found with UID ${id}.`;

        const body = await downloadTextPart(client, id, m.bodyStructure);
        return [
          `**From:** ${fmtAddr(m.envelope.from)}`,
          `**To:** ${fmtAddr(m.envelope.to, true)}`,
          `**Date:** ${fmtDate(m.envelope.date)}`,
          `**Subject:** ${m.envelope.subject ?? '(no subject)'}`,
          `**Flags:** ${fmtFlags(m.flags)}`,
          '',
          '---',
          '',
          body,
        ].join('\n');
      });
    },
  };
}

export function createEmailTagTool(): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'email-tag',
        description: 'Add or remove flags/tags on emails (seen, flagged, answered, draft, deleted).',
        parameters: {
          type: 'object',
          properties: {
            account: { type: 'string', description: 'Account index (e.g., "1", "2")' },
            mailbox: { type: 'string', description: 'IMAP folder (default: account default)' },
            uid: { type: 'string', description: 'UID(s) comma-separated (e.g. "123" or "123,456")' },
            action: { type: 'string', description: '"add" or "remove"' },
            flags: { type: 'string', description: 'Comma-separated flags (seen, flagged, urgent, todo…)' },
          },
          required: ['account', 'uid', 'action', 'flags'],
          additionalProperties: false,
        },
      },
    },
    permission: { matchKey: () => undefined },
    async execute(args) {
      const { account, mailbox, uid, action, flags } = args as { account: string; mailbox?: string; uid: string; action: string; flags: string };
      const n = parseInt(account, 10);
      if (Number.isNaN(n) || n < 1) return { content: `Invalid account ID: "${account}".`, error: true };
      const config = getAccountConfig(n);
      const folder = mailbox || config.mailbox;
      const add = action.toLowerCase().trim() === 'add';
      if (!add && action.toLowerCase().trim() !== 'remove') return { content: 'Action must be "add" or "remove".', error: true };

      const resolved = csv(flags).map((f) => FLAG_ALIASES[f.toLowerCase()] ?? f);
      if (!resolved.length) return { content: 'At least one flag is required.', error: true };
      const range = csv(uid).join(',');

      return withMailbox(config, folder, async (client) => {
        if (add) await client.messageFlagsAdd(range, resolved, { uid: true });
        else await client.messageFlagsRemove(range, resolved, { uid: true });
        return `Flags ${resolved.join(', ')} ${add ? 'added to' : 'removed from'} UID ${range}.`;
      });
    },
  };
}

export function createEmailMoveTool(): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'email-move',
        description: 'Move emails to another folder (Archive, Trash, Spam…).',
        parameters: {
          type: 'object',
          properties: {
            account: { type: 'string', description: 'Account index (e.g., "1", "2")' },
            mailbox: { type: 'string', description: 'IMAP folder (default: account default)' },
            uid: { type: 'string', description: 'UID(s) comma-separated' },
            destination: { type: 'string', description: 'Destination folder' },
          },
          required: ['account', 'uid', 'destination'],
          additionalProperties: false,
        },
      },
    },
    permission: { matchKey: () => undefined },
    async execute(args) {
      const { account, mailbox, uid, destination } = args as { account: string; mailbox?: string; uid: string; destination: string };
      const n = parseInt(account, 10);
      if (Number.isNaN(n) || n < 1) return { content: `Invalid account ID: "${account}".`, error: true };
      const config = getAccountConfig(n);
      const folder = mailbox || config.mailbox;
      const dest = destination.trim();
      if (!dest) return { content: 'Destination is required.', error: true };
      const range = csv(uid).join(',');

      return withMailbox(config, folder, async (client) => {
        await client.messageMove(range, dest, { uid: true });
        return `UID ${range} moved from "${folder}" to "${dest}".`;
      });
    },
  };
}

export function createEmailListFoldersTool(): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'email-list-folders',
        description: 'List all IMAP folders/mailboxes.',
        parameters: {
          type: 'object',
          properties: {
            account: { type: 'string', description: 'Account index (e.g., "1", "2")' },
          },
          required: ['account'],
          additionalProperties: false,
        },
      },
    },
    permission: { matchKey: () => undefined },
    async execute(args) {
      const n = parseInt(String(args.account), 10);
      if (Number.isNaN(n) || n < 1) return { content: `Invalid account ID: "${args.account}".`, error: true };
      const config = getAccountConfig(n);

      return withClient(config, async (client) => {
        const list = await client.list();
        if (!list.length) return 'No folders found.';
        const rows = list
          .sort((a, b) => a.path.localeCompare(b.path))
          .map((f) => {
            const special = f.specialUse || '-';
            const flags = [...(f.flags || [])].join(', ') || '-';
            return `| ${f.path} | ${special} | ${flags} |`;
          });
        return [
          '| Path | Special Use | Flags |',
          '|------|-------------|-------|',
          ...rows,
          '',
          `Total: ${list.length} folder(s)`,
        ].join('\n');
      });
    },
  };
}

export function createEmailCreateFolderTool(): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'email-create-folder',
        description: 'Create a new IMAP folder/mailbox.',
        parameters: {
          type: 'object',
          properties: {
            account: { type: 'string', description: 'Account index (e.g., "1", "2")' },
            path: { type: 'string', description: 'Folder path to create (e.g. "Newsletters")' },
          },
          required: ['account', 'path'],
          additionalProperties: false,
        },
      },
    },
    permission: { matchKey: () => undefined },
    async execute(args) {
      const { account, path: folderPath } = args as { account: string; path: string };
      const n = parseInt(account, 10);
      if (Number.isNaN(n) || n < 1) return { content: `Invalid account ID: "${account}".`, error: true };
      const config = getAccountConfig(n);
      const name = folderPath.trim();
      if (!name) return { content: 'Folder path is required.', error: true };

      return withClient(config, async (client) => {
        const result = await client.mailboxCreate(name);
        return `Folder "${result.path}" created.`;
      });
    },
  };
}

export function createEmailListAccountsTool(): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'email-list-accounts',
        description: 'List all configured email accounts.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    },
    permission: { matchKey: () => undefined },
    async execute() {
      const accounts = listAvailableAccounts();
      if (!accounts.length) return 'No email accounts configured.';
      const rows = accounts.map((a) => `| ${a.id} | ${a.user} | ${a.host} |`);
      return [
        '| ID | User | Host |',
        '|----|--------------------|--------------------|',
        ...rows,
        '',
        `Total: ${accounts.length} account(s)`,
      ].join('\n');
    },
  };
}
