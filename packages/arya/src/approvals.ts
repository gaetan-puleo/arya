import type { AgentSessionHooks } from 'mu-harness';
import { requireApproval } from 'mu-harness';

export interface PendingApproval {
  id: string;
  toolName: string;
  args: string;
}

export type ApprovalListener = (req: PendingApproval) => void;

export interface ApprovalManager {
  hooks: AgentSessionHooks;
  pending(): PendingApproval[];
  resolve(id: string, action: 'approve' | 'approve_always' | 'deny'): boolean;
  subscribe(listener: ApprovalListener): () => void;
}

export interface ApprovalManagerOptions {
  askTools?: string[];
  newId?: () => string;
}

const DEFAULT_ASK_TOOLS = ['write', 'edit', 'bash', 'subagent'];

export function createApprovalManager(options: ApprovalManagerOptions = {}): ApprovalManager {
  const askTools = new Set(options.askTools ?? DEFAULT_ASK_TOOLS);
  const alwaysAllow = new Set<string>();
  const newId = options.newId ?? (() => crypto.randomUUID());

  const waiters = new Map<string, { resolve: (allow: boolean) => void; req: PendingApproval }>();
  const listeners = new Set<ApprovalListener>();

  const hooks = requireApproval({
    needsApproval: ({ name }) => askTools.has(name) && !alwaysAllow.has(name),
    newId,
    prompt: (call) =>
      new Promise<boolean>((resolve) => {
        const req: PendingApproval = { id: call.id, toolName: call.name, args: JSON.stringify(call.input ?? {}) };
        waiters.set(call.id, { resolve, req });
        for (const listener of listeners) listener(req);
      }),
  });

  return {
    hooks,
    pending: () => [...waiters.values()].map((w) => w.req),
    resolve: (id, action) => {
      const waiter = waiters.get(id);
      if (!waiter) return false;
      waiters.delete(id);
      if (action === 'approve_always') alwaysAllow.add(waiter.req.toolName);
      waiter.resolve(action !== 'deny');
      return true;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
