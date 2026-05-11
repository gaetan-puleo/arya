/**
 * IDFM (Île-de-France Mobilités) transport tools.
 *
 * Tools:
 *  - idfm-journeys      : Real-time journey planning between 2 points in IDF
 *  - idfm-line-reports  : Traffic disruptions for a specific line
 *  - idfm-places-nearby : Find nearby transport stops
 *
 * Requires IDFM_API_KEY environment variable.
 * Sign up: https://prim.iledefrance-mobilites.fr/
 */

import type { PluginTool } from 'mu-core';

const BASE_URL = 'https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia';

function readApiKey(): string {
  const key = process.env.IDFM_API_KEY?.trim();
  if (!key) throw new Error('Missing IDFM_API_KEY environment variable');
  return key;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function navitiaGet(
  path: string,
  params: Record<string, string | undefined>,
): Promise<unknown> {
  const qs = new URLSearchParams();
  qs.set('disable_geojson', 'true');
  qs.set('language', 'fr-FR');
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, v);
  }
  const url = `${BASE_URL}${path}?${qs}`;
  const res = await fetch(url, { headers: { apikey: readApiKey() } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`IDFM erreur ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

interface Section {
  type?: string;
  duration?: number;
  from?: { name?: string };
  to?: { name?: string };
  departure_date_time?: string;
  arrival_date_time?: string;
  display_informations?: {
    commercial_mode?: string;
    label?: string;
    direction?: string;
  };
}

interface Journey {
  duration?: number;
  nb_transfers?: number;
  departure_date_time?: string;
  arrival_date_time?: string;
  sections?: Section[];
}

function formatTime(dt?: string): string {
  if (!dt || dt.length < 13) return dt ?? '';
  return `${dt.slice(9, 11)}:${dt.slice(11, 13)}`;
}

function formatSection(s: Section): string {
  const dep = formatTime(s.departure_date_time);
  const arr = formatTime(s.arrival_date_time);
  const dur = Math.round((s.duration ?? 0) / 60);

  if (s.type === 'public_transport') {
    const info = s.display_informations;
    const mode = [info?.commercial_mode, info?.label].filter(Boolean).join(' ');
    return `${dep}-${arr} ${mode} ${s.from?.name ?? ''} -> ${s.to?.name ?? ''} (${dur}min)`;
  }

  const sectionTypes: Record<string, () => string> = {
    transfer: () => `correspondance (${dur}min)`,
    waiting: () => `attente (${dur}min)`,
    street_network: () =>
      `${dep}-${arr} marche ${s.from?.name ?? ''} -> ${s.to?.name ?? ''} (${dur}min)`,
    crow_fly: () =>
      `${dep}-${arr} marche ${s.from?.name ?? ''} -> ${s.to?.name ?? ''} (${dur}min)`,
  };

  const typeKey = s.type ?? '';
  const formatter = sectionTypes[typeKey];
  return formatter ? formatter() : `${s.type ?? '?'} (${dur}min)`;
}

function formatJourney(j: Journey, idx: number): string {
  const dep = formatTime(j.departure_date_time);
  const arr = formatTime(j.arrival_date_time);
  const dur = Math.round((j.duration ?? 0) / 60);
  const lines = [
    `Option ${idx + 1}: ${dep} -> ${arr} (${dur}min, ${j.nb_transfers ?? 0} correspondance(s))`,
  ];
  for (const s of j.sections ?? []) {
    if (s.type === 'waiting') continue;
    lines.push(`  ${formatSection(s)}`);
  }
  return lines.join('\n');
}

export function createIdfmJourneysTool(): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'idfm-journeys',
        description:
          'Itinéraire temps réel entre 2 points en IDF. Retourne les 3 prochains trajets avec lignes, correspondances, durées et horaires.',
        parameters: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'Origine: URI Navitia ou coordonnées lon;lat' },
            to: { type: 'string', description: 'Destination: URI Navitia ou coordonnées lon;lat' },
            datetime: { type: 'string', description: 'Date/heure au format YYYYMMDDTHHMMSS (ex: 20260304T070000)' },
            datetime_represents: { type: 'string', description: '"departure" ou "arrival"' },
          },
          additionalProperties: false,
        },
      },
    },
    permission: {
      matchKey: () => undefined,
    },
    async execute(args) {
      const typedArgs = args as { from?: string; to?: string; datetime?: string; datetime_represents?: string };
      const data = (await navitiaGet('/journeys', {
        from: typedArgs.from,
        to: typedArgs.to,
        datetime: typedArgs.datetime,
        datetime_represents: typedArgs.datetime_represents ?? 'departure',
        data_freshness: 'realtime',
        count: '3',
        min_nb_journeys: '3',
      })) as { journeys?: Journey[]; error?: { message?: string } };

      if (data.error)
        throw new Error(`IDFM: ${data.error.message ?? JSON.stringify(data.error)}`);
      const js = data.journeys ?? [];
      if (js.length === 0) return 'Aucun itinéraire trouvé.';
      const lines = [`Itinéraires trouvés (${js.length}):`];
      for (let i = 0; i < js.length; i++) lines.push(formatJourney(js[i], i));
      return lines.join('\n');
    },
  };
}

interface Disruption {
  id: string;
  status?: string;
  cause?: string;
  severity?: { name?: string; effect?: string };
  messages?: { text?: string; channel?: { name?: string } }[];
  application_periods?: { begin?: string; end?: string }[];
}

interface LineReport {
  line?: {
    id?: string;
    name?: string;
    code?: string;
    commercial_mode?: { name?: string };
    network?: { name?: string };
  };
  pt_objects?: { id?: string; name?: string; embedded_type?: string }[];
}

function formatDisruption(d: Disruption): string {
  const parts: string[] = [];
  if (d.severity?.name) parts.push(`[${d.severity.name}]`);
  if (d.severity?.effect) parts.push(`(${d.severity.effect})`);
  if (d.cause) parts.push(`Cause: ${d.cause}`);
  const msg =
    d.messages?.find((m) => m.channel?.name === 'moteur' || m.text)?.text ??
    d.messages?.[0]?.text;
  if (msg) parts.push(stripHtml(msg));
  if (d.application_periods?.length) {
    const p = d.application_periods[0];
    parts.push(`Période: ${p.begin ?? '?'} -> ${p.end ?? '?'}`);
  }
  if (d.status) parts.push(`Statut: ${d.status}`);
  return parts.join(' | ');
}

function formatLineReport(lr: LineReport, disruptions: Disruption[]): string {
  const line = lr.line;
  const header = [
    line?.commercial_mode?.name,
    line?.code || line?.name,
    line?.network?.name ? `(${line.network.name})` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const linked = (lr.pt_objects ?? [])
    .filter((o) => o.embedded_type === 'impact')
    .map((o) => disruptions.find((d) => d.id === o.id))
    .filter(Boolean) as Disruption[];
  if (linked.length === 0) return `${header}: OK - aucune perturbation`;
  return `${header}:\n${linked.map((d) => `  - ${formatDisruption(d)}`).join('\n')}`;
}

export function createIdfmLineReportsTool(): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'idfm-line-reports',
        description:
          "Perturbations et état du trafic d'une ligne IDF (métro, RER, Transilien, tram, bus, TER). Retourne sévérité, cause et périodes d'application.",
        parameters: {
          type: 'object',
          properties: {
            uri: { type: 'string', description: 'URI Navitia de la ligne (ex: lines/line:IDFM:C01736 pour Ligne N)' },
            since: { type: 'string', description: 'Perturbations actives après cette date ISO (ex: 2026-03-04T00:00:00)' },
            until: { type: 'string', description: 'Perturbations actives avant cette date ISO' },
          },
          additionalProperties: false,
        },
      },
    },
    permission: {
      matchKey: () => undefined,
    },
    async execute(args) {
      const typedArgs = args as { uri?: string; since?: string; until?: string };
      const params: Record<string, string | undefined> = {
        depth: '2',
        since: typedArgs.since,
        until: typedArgs.until,
      };

      const data = (await navitiaGet(
        `/${typedArgs.uri}/line_reports`,
        params,
      )) as {
        line_reports?: LineReport[];
        disruptions?: Disruption[];
        error?: { message?: string };
      };

      if (data.error)
        throw new Error(`IDFM: ${data.error.message ?? JSON.stringify(data.error)}`);

      const reports = data.line_reports ?? [];
      const disruptions = data.disruptions ?? [];

      if (reports.length === 0) return 'Aucune ligne trouvée pour cette URI.';

      const perturbed = reports.filter((lr) =>
        (lr.pt_objects ?? []).some((o) => o.embedded_type === 'impact'),
      );
      const ok = reports.length - perturbed.length;

      const lines: string[] = [];
      lines.push(
        `Trafic IDFM: ${reports.length} ligne(s), ${perturbed.length} perturbée(s), ${ok} OK`,
      );
      lines.push('');
      for (const lr of perturbed) lines.push(formatLineReport(lr, disruptions));
      if (perturbed.length === 0) lines.push('Aucune perturbation en cours.');

      return lines.join('\n');
    },
  };
}

interface PlaceNearby {
  id?: string;
  name?: string;
  distance?: number;
  embedded_type?: string;
}

export function createIdfmPlacesNearbyTool(): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'idfm-places-nearby',
        description:
          "Trouve les arrêts de transport en commun (stop_area) proches d'un lieu. Utilisé pour résoudre un nom de lieu en URI Navitia avant d'appeler idfm-journeys.",
        parameters: {
          type: 'object',
          properties: {
            q: { type: 'string', description: "Nom du lieu, adresse ou ville (ex: 'Rambouillet gare')" },
            coords: { type: 'string', description: 'Coordonnées GPS au format lon;lat (ex: 1.8206;48.6445)' },
            count: { type: 'integer', description: "Nombre d'arrêts à retourner (max 20, default: 5)" },
          },
          additionalProperties: false,
        },
      },
    },
    permission: {
      matchKey: () => undefined,
    },
    async execute(args) {
      const typedArgs = args as { q?: string; coords?: string; count?: number };

      if (!typedArgs.q && !typedArgs.coords) {
        return { content: 'Erreur: Fournis soit q (nom/adresse) soit coords (lon;lat)', error: true };
      }

      let stops: PlaceNearby[] = [];

      if (typedArgs.coords) {
        const data = (await navitiaGet(`/coords/${typedArgs.coords}/places_nearby`, {
          'type[]': 'stop_area',
          count: String(typedArgs.count ?? 5),
        })) as { places_nearby?: PlaceNearby[]; error?: { message?: string } };
        if (data.error) throw new Error(`IDFM: ${data.error.message ?? JSON.stringify(data.error)}`);
        stops = data.places_nearby ?? [];
      } else {
        const qs = new URLSearchParams();
        qs.set('q', typedArgs.q!);
        qs.set('type[]', 'stop_area');
        qs.set('count', String(typedArgs.count ?? 5));
        qs.set('disable_geojson', 'true');
        qs.set('language', 'fr-FR');
        const url = `${BASE_URL}/places?${qs}`;
        const res = await fetch(url, { headers: { apikey: readApiKey() } });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`IDFM erreur ${res.status}: ${body.slice(0, 300)}`);
        }
        const data = (await res.json()) as {
          places?: (PlaceNearby & { embedded_type?: string })[];
          error?: { message?: string };
        };
        if (data.error) throw new Error(`IDFM: ${data.error.message ?? JSON.stringify(data.error)}`);
        stops = (data.places ?? []).filter((p) => p.embedded_type === 'stop_area');
      }

      if (stops.length === 0) return 'Aucun arrêt trouvé pour ce lieu.';
      const lines = stops.map((p) => {
        const dist = p.distance ? ` (${p.distance}m)` : '';
        return `${p.id} | ${p.name}${dist}`;
      });
      return `Arrêts trouvés:\n${lines.join('\n')}`;
    },
  };
}
