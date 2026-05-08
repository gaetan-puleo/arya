export interface CommandInfo {
  command: string;
  description: string;
}

export interface AgentInfo {
  id: string;
  description: string;
}

export interface ApprovalRequest {
  requestId: string;
  token: string;
  channelId: string;
  toolName: string;
  toolArgs: unknown;
  agentId: string;
  createdAt: number;
}

export type ActivityEventKind =
  | 'agent_start'
  | 'agent_end'
  | 'tool_start'
  | 'tool_end'
  | 'task_started'
  | 'task_completed'
  | 'task_error';

export interface ActivityEvent {
  id: number;
  ts: number;
  kind: ActivityEventKind;
  source: string;
  summary: string;
  detail?: Record<string, unknown>;
}

// ── Sub-agent invocation events ──

export type SubAgentEventKind =
  | 'invocation_start'
  | 'text_delta'
  | 'message_end'
  | 'tool_call_start'
  | 'tool_call_end'
  | 'invocation_end';

export interface SubAgentEvent {
  runId: string;
  parentRunId?: string;
  agentId: string;
  kind: SubAgentEventKind;
  ts: number;
  data: Record<string, unknown>;
}

export interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

export interface VoiceMessage {
  id: string;
  role: 'user';
  audioUri?: string;
  timestamp: number;
}

export type Message = ChatMessage | VoiceMessage;

export interface PendingApproval {
  requestId: string;
  token: string;
  channelId: string;
  toolName: string;
  toolArgs: unknown;
  agentId: string;
  createdAt: number;
}

function formatToolName(name: string): string {
  const parts = name.split('.');
  if (parts.length === 1) return name;
  const tool = parts[parts.length - 1];
  const prefix = parts.slice(0, -1).join('.');
  return `${prefix}.${tool}`;
}

function formatToolArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const obj = args as Record<string, unknown>;
  const entries = Object.entries(obj).slice(0, 5);
  return entries
    .map(([key, value]) => {
      const display = typeof value === 'string' ? value : JSON.stringify(value);
      return `${key}: ${display}`;
    })
    .join('\n');
}

function getToolDescription(toolName: string): string {
  const descriptions: Record<string, string> = {
    'fs.read_file': 'Lire un fichier',
    'fs.write_file': 'Écrire dans un fichier',
    'fs.delete_file': 'Supprimer un fichier',
    'fs.list_dir': 'Lister un répertoire',
    'fs.copy_file': 'Copier un fichier',
    'fs.move_file': 'Déplacer un fichier',
    'fs.create_dir': 'Créer un répertoire',
    'shell.execute': 'Exécuter une commande shell',
    'http.fetch': 'Faire une requête HTTP',
    'calendar.create_event': 'Créer un événement calendrier',
    'calendar.list_events': 'Lister les événements',
    'calendar.delete_event': 'Supprimer un événement',
    'email.send': 'Envoyer un email',
    'email.read': 'Lire des emails',
    'homeassistant.turn_on': 'Allumer un appareil',
    'homeassistant.turn_off': 'Éteindre un appareil',
    'homeassistant.set_state': 'Changer l\'état d\'un appareil',
    'homeassistant.call_service': 'Appeler un service Home Assistant',
    'obsidian.create_note': 'Créer une note Obsidian',
    'obsidian.search': 'Rechercher dans Obsidian',
    'obsidian.read_note': 'Lire une note Obsidian',
    'qonto.get_transactions': 'Consulter les transactions bancaires',
    'qonto.get_accounts': 'Consulter les comptes bancaires',
    'qonto.get_transfers': 'Consulter les virements',
    'agent.run_agent': 'Exécuter un autre agent',
  };
  return descriptions[toolName] || `Exécuter l'outil "${toolName}"`;
}

export function formatApprovalMessage(request: ApprovalRequest): string {
  const toolName = formatToolName(request.toolName);
  const description = getToolDescription(request.toolName);
  const args = formatToolArgs(request.toolArgs);

  let message = `[LOCK] ${description} (via ${request.channelId})`;
  if (args) {
    message += `\n${args}`;
  }
  return message;
}
