// Minimal "setup mode" WebSocket server for arya's first run.
//
// Started (instead of the real harness) whenever an entrypoint finds config
// missing a mandatory field: `arya serve` hosts it on a reachable address for
// channels (companion/TUI) to connect and answer; `arya --channel tui` hosts it
// on loopback and connects its own TUI client to it. It speaks the same WS chat
// protocol as the real server, owns no provider/harness/LLM, drives the
// question/answer engine from init.ts, and writes config.json. On completion it
// resolves `done`; the caller exits and asks the user to relaunch.

import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { parseInbound, type WireAgent, type WireMessage, type WsOutbound } from 'mu-harness';
import { applyAnswer, type Config, createSetupState, currentQuestion, type SetupQuestion, writeConfig } from './init';

export interface SetupServerOptions {
  port: number;
  host: string;
  startingConfig: Config;
  configPath: string;
  /** When set, clients must connect with a matching `?token=`. */
  authToken?: string;
  log?: (msg: string) => void;
}

export interface SetupServerHandle {
  /** Resolves once config has been written. */
  done: Promise<{ configPath: string; config: Config }>;
  stop(): Promise<void>;
}

const SESSION = 'setup';
const SETUP_AGENT: WireAgent = { name: 'arya-setup', description: 'First-run configuration', color: '#3B82F6' };

const promptText = (q: SetupQuestion): string => `${q.prompt}${q.default ? ` [${q.default}]` : ''}`;

export function startSetupServer(opts: SetupServerOptions): Promise<SetupServerHandle> {
  const log = opts.log ?? (() => {});

  return new Promise<SetupServerHandle>((resolveStart, rejectStart) => {
    const wss = new WebSocketServer({ port: opts.port, host: opts.host });
    let resolveDone!: (v: { configPath: string; config: Config }) => void;
    const done = new Promise<{ configPath: string; config: Config }>((r) => (resolveDone = r));
    const states = new WeakMap<WebSocket, ReturnType<typeof createSetupState>>();
    let finished = false;

    const send = (ws: WebSocket, frame: WsOutbound): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
    };
    const assistant = (text: string): WsOutbound => ({
      type: 'message',
      sessionId: SESSION,
      message: { id: crypto.randomUUID(), ts: Date.now(), role: 'assistant', content: text } as WireMessage,
    });

    const finish = (config: Config): void => {
      if (finished) return;
      finished = true;
      writeConfig(opts.configPath, config);
      log(`config written to ${opts.configPath}`);
      const token = typeof config.authToken === 'string' && config.authToken ? config.authToken : '';
      const tokenNote = token ? `\n\nAccess token: ${token}\n(Companion: paste this into Settings → Token.)` : '';
      for (const client of wss.clients) {
        send(client as WebSocket, assistant(`Setup complete — configuration saved.${tokenNote}\n\nRelaunch to start arya:  arya serve`));
      }
      resolveDone({ configPath: opts.configPath, config });
    };

    const handleText = (ws: WebSocket, text: string): void => {
      const state = states.get(ws);
      if (!state || finished) return;
      const step = applyAnswer(state, text);
      if (step.kind === 'ask') send(ws, assistant(promptText(step.question)));
      else if (step.kind === 'reask') send(ws, assistant(`${step.error}\n${promptText(step.question)}`));
      else finish(step.config);
    };

    const onMessage = (ws: WebSocket, raw: unknown): void => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        send(ws, { type: 'error', message: 'invalid JSON' });
        return;
      }
      const msg = parseInbound(parsed);
      if ('error' in msg) {
        send(ws, { type: 'error', message: msg.error });
        return;
      }
      switch (msg.type) {
        case 'chat':
        case 'command':
          handleText(ws, msg.text);
          return;
        case 'commands':
          send(ws, { type: 'commands', commands: [] });
          return;
        case 'agents':
          send(ws, { type: 'agents', agents: [SETUP_AGENT], activeAgentId: SETUP_AGENT.name });
          return;
        case 'sessions:list':
          send(ws, { type: 'sessions:listed', sessions: [] });
          return;
        case 'models:list':
          send(ws, { type: 'models:listed', models: [], selected: '' });
          return;
        case 'abort':
          send(ws, { type: 'turn_end', sessionId: msg.sessionId ?? SESSION, reason: 'aborted' });
          return;
        default:
          return; // ignore anything else in setup mode
      }
    };

    wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      if (opts.authToken) {
        const token = new URL(req.url ?? '', 'ws://localhost').searchParams.get('token');
        if (token !== opts.authToken) {
          ws.close(1008, 'unauthorized');
          return;
        }
      }
      // Handshake so the TUI's connectHarness (which awaits an `agents` frame) resolves.
      send(ws, { type: 'commands', commands: [] });
      send(ws, { type: 'capabilities', vision: false, audio: false });
      send(ws, { type: 'agents', agents: [SETUP_AGENT], activeAgentId: SETUP_AGENT.name });
      send(ws, { type: 'sessions:listed', sessions: [] });

      const state = createSetupState(opts.startingConfig);
      states.set(ws, state);
      send(ws, assistant("Welcome to arya — let's set up your provider. Type your answer below (Enter accepts the [default])."));
      const q = currentQuestion(state);
      if (q) send(ws, assistant(promptText(q)));

      ws.on('message', (raw: unknown) => onMessage(ws, raw));
    });

    wss.on('listening', () => {
      log(`setup server listening on ${opts.host}:${opts.port}`);
      resolveStart({
        done,
        stop: () =>
          new Promise<void>((res) => {
            for (const c of wss.clients) {
              try {
                (c as WebSocket).close();
              } catch {
                // ignore
              }
            }
            wss.close(() => res());
          }),
      });
    });

    wss.on('error', (err: Error) => rejectStart(err));
  });
}
