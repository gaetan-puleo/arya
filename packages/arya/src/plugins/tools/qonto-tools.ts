/**
 * Qonto banking tools.
 *
 * Tools:
 *  - qonto-transactions : List bank transactions with filters
 *  - qonto-balance      : Show current balance of all accounts
 *
 * Requires QONTO_API_KEY and QONTO_COMPANY_SLUG environment variables.
 * Doc: https://api-doc.qonto.com/docs/business-api/
 */

import type { PluginTool } from 'mu-core';

const BASE_URL = 'https://thirdparty.qonto.com/v2';

function readCredentials(): string {
  const slug = process.env.QONTO_COMPANY_SLUG?.trim();
  const key = process.env.QONTO_API_KEY?.trim();
  if (!slug) throw new Error('Missing QONTO_COMPANY_SLUG environment variable');
  if (!key) throw new Error('Missing QONTO_API_KEY environment variable');
  return `${slug}:${key}`;
}

async function qontoGet(path: string): Promise<unknown> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: readCredentials(),
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Qonto erreur ${res.status}: ${bodyText.slice(0, 300)}`);
  }
  return res.json();
}

function formatAmount(amount: number, currency: string): string {
  const formatted = (amount / 100).toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const symbol = currency === 'EUR' ? '€' : currency;
  return `${formatted} ${symbol}`;
}

function formatDate(dateStr?: string): string {
  if (!dateStr || dateStr.length < 10) return dateStr ?? '?';
  const date = new Date(dateStr);
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

interface Transaction {
  id?: string;
  amount_cents?: number;
  side?: 'credit' | 'debit';
  operation_type?: string;
  currency?: string;
  label?: string;
  status?: string;
  emitted_at?: string;
}

interface BankAccount {
  id?: string;
  iban?: string;
  balance_cents?: number;
  currency?: string;
  slug?: string;
  name?: string;
}

interface Organization {
  organization?: { bank_accounts?: BankAccount[] };
}

interface TransactionMeta {
  total_pages?: number;
}

const VALID_STATUSES = ['completed', 'pending', 'declined'] as const;
const VALID_SIDES = ['credit', 'debit'] as const;
const VALID_OPERATION_TYPES = [
  'card', 'transfer', 'income', 'direct_debit', 'direct_debit_collection',
  'qonto_fee', 'cheque', 'recall', 'swift_income', 'pay_later',
  'financing_installment', 'account_remuneration', 'f24', 'pagopa_payment',
  'nrc_payment', 'riba_payment', 'investment', 'other',
] as const;

const TYPE_LABELS: Record<string, string> = {
  card: 'carte', transfer: 'virement', income: 'reçu',
  direct_debit: 'prélèvement', direct_debit_collection: 'collecte',
  qonto_fee: 'frais', swift_income: 'virement intl', cheque: 'chèque',
  financing_installment: 'échéance', account_remuneration: 'rémunération',
  investment: 'investissement', pay_later: 'paiement différé', recall: 'rappel',
  f24: 'F24', pagopa_payment: 'PagoPA', nrc_payment: 'NRC', riba_payment: 'RIBA',
  other: 'autre',
};

function csvSplit(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((v) => v.trim()).filter(Boolean);
}

async function getOrganizationAccounts(): Promise<BankAccount[]> {
  const orgData = (await qontoGet('/organization')) as Organization;
  return orgData.organization?.bank_accounts ?? [];
}

function filterAccountsByIban(accounts: BankAccount[], iban?: string): BankAccount[] {
  if (!iban) return accounts;
  return accounts.filter((a) => a.iban?.toUpperCase().includes(iban.toUpperCase()));
}

export function createQontoTransactionsTool(): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'qonto-transactions',
        description:
          'Liste les transactions bancaires. Filtres: date, IBAN, statut, sens, type. Options: max_pages, includes.',
        parameters: {
          type: 'object',
          properties: {
            iban: { type: 'string', description: "IBAN du compte (optionnel)" },
            from_date: { type: 'string', description: 'Date de début (YYYY-MM-DD)' },
            to_date: { type: 'string', description: 'Date de fin (YYYY-MM-DD)' },
            status: { type: 'string', description: 'Statut(s) séparés par virgule: completed, pending, declined' },
            side: { type: 'string', description: 'Sens(s) séparés par virgule: credit, debit' },
            operation_type: { type: 'string', description: 'Type(s) séparés par virgule: card, transfer, income, direct_debit, qonto_fee, etc.' },
            max_pages: { type: 'integer', description: 'Nombre maximum de pages à récupérer' },
            includes: { type: 'string', description: 'Inclure: labels, attachments, vat_details (séparés par virgule)' },
            sort_by: { type: 'string', description: 'Tri: created_at:desc, settled_at:asc' },
          },
          additionalProperties: false,
        },
      },
    },
    permission: {
      matchKey: () => undefined,
    },
    async execute(args) {
      const {
        iban, from_date, to_date, status, side, operation_type,
        max_pages, includes, sort_by,
      } = args as {
        iban?: string; from_date?: string; to_date?: string;
        status?: string; side?: string; operation_type?: string;
        max_pages?: number; includes?: string; sort_by?: string;
      };

      // Validate
      const sides = csvSplit(side);
      if (sides.length > 0 && !sides.every((s) => VALID_SIDES.includes(s as typeof VALID_SIDES[number]))) {
        throw new Error(`Sens invalide. Valeurs: ${VALID_SIDES.join(', ')}`);
      }
      const opTypes = csvSplit(operation_type);
      if (opTypes.length > 0 && !opTypes.every((t) => VALID_OPERATION_TYPES.includes(t as typeof VALID_OPERATION_TYPES[number]))) {
        throw new Error(`Type invalide. Valeurs: ${VALID_OPERATION_TYPES.join(', ')}`);
      }
      const statuses = csvSplit(status);
      if (statuses.length > 0 && !statuses.every((s) => VALID_STATUSES.includes(s as typeof VALID_STATUSES[number]))) {
        throw new Error(`Statut invalide. Valeurs: ${VALID_STATUSES.join(', ')}`);
      }
      const includeOpts = csvSplit(includes);
      const validIncludes = ['labels', 'attachments', 'vat_details'];
      if (includeOpts.some((i) => !validIncludes.includes(i))) {
        throw new Error(`Include invalide. Valeurs: ${validIncludes.join(', ')}`);
      }
      if (sort_by) {
        const parts = sort_by.split(':');
        if (parts.length !== 2 || !['created_at', 'updated_at', 'settled_at', 'emitted_at'].includes(parts[0]) || !['asc', 'desc'].includes(parts[1])) {
          throw new Error(`Tri invalide. Format: property:order (ex: settled_at:desc)`);
        }
      }

      const accounts = await getOrganizationAccounts();
      const filteredAccounts = filterAccountsByIban(accounts, iban);
      if (filteredAccounts.length === 0)
        return iban ? `Aucun compte trouvé avec l'IBAN ${iban}.` : 'Aucun compte bancaire trouvé.';

      // Fetch all transactions
      const all: Transaction[] = [];
      const seen = new Set<string>();

      for (const account of filteredAccounts) {
        for (let page = 1; page <= (max_pages ?? 1); page++) {
          const qs = new URLSearchParams();
          qs.set('page', String(page));
          qs.set('per_page', '100');
          if (iban) qs.set('iban', iban);
          if (from_date) qs.set('emitted_at_from', `${from_date}T00:00:00.000Z`);
          if (to_date) qs.set('emitted_at_to', `${to_date}T23:59:59.999Z`);
          for (const s of statuses) qs.append('status[]', s);
          for (const s of sides) qs.append('side', s);
          for (const t of opTypes) qs.append('operation_type[]', t);
          for (const i of includeOpts) qs.append('includes[]', i);
          if (sort_by) qs.set('sort_by', sort_by);

          const data = (await qontoGet(`/transactions?${qs}`)) as {
            transactions?: Transaction[];
            meta?: TransactionMeta;
          };

          for (const t of data.transactions ?? []) {
            if (t.id && !seen.has(t.id)) {
              seen.add(t.id);
              all.push(t);
            }
          }
          if (page >= (data.meta?.total_pages ?? 1)) break;
        }
      }

      if (all.length === 0) return 'Aucune transaction trouvée.';

      const sorted = [...all].sort((a, b) => (b.emitted_at ?? '').localeCompare(a.emitted_at ?? ''));
      const lines = [
        '| Date | Sens | Libellé | Type | Montant | Statut |',
        '|------|------|---------|------|---------|--------|',
        ...sorted.map((t) => {
          const sideStr = t.side === 'credit' ? 'crédit' : t.side === 'debit' ? 'débit' : '?';
          const type = TYPE_LABELS[t.operation_type ?? ''] ?? t.operation_type ?? '?';
          const amount = t.amount_cents !== undefined
            ? `${t.side === 'credit' ? '+' : '-'}${formatAmount(t.amount_cents, t.currency ?? 'EUR')}`
            : '?';
          return `| ${formatDate(t.emitted_at)} | ${sideStr} | ${t.label ?? '?'} | ${type} | ${amount} | ${t.status ?? '?'} |`;
        }),
        '',
        `Total: ${all.length} transaction(s)`,
      ];
      return lines.join('\n');
    },
  };
}

export function createQontoBalanceTool(): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'qonto-balance',
        description: "Affiche le solde courant de tous les comptes bancaires liés à l'organisation.",
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    },
    permission: {
      matchKey: () => undefined,
    },
    async execute() {
      const accounts = await getOrganizationAccounts();
      if (accounts.length === 0) return 'Aucun compte bancaire trouvé.';

      const lines = [
        '| Compte | IBAN | Solde | Solde autorisé | Devise |',
        '|--------|------|-------|---------------|--------|',
        ...accounts.map((a) => {
          const name = a.name ?? a.slug ?? '?';
          const iban = a.iban ?? '?';
          const balance = a.balance_cents !== undefined ? formatAmount(a.balance_cents, a.currency ?? 'EUR') : '?';
          return `| ${name} | ${iban} | ${balance} | ? | ${a.currency ?? 'EUR'} |`;
        }),
        '',
      ];
      const total = accounts.reduce((sum, a) => sum + (a.balance_cents ?? 0), 0);
      lines.push(`**Solde total:** ${formatAmount(total, 'EUR')}`);
      return lines.join('\n');
    },
  };
}
