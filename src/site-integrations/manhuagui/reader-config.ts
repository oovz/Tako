import logger from '@/src/runtime/logger';
import { rateLimitedFetchByUrlScope } from '@/src/runtime/rate-limit';
import { sanitizeLabel } from '@/src/shared/site-integration-utils';
import { toAbsoluteUrl } from './shared';

/**
 * Weighted image host (e.g. `eu`, `us1`) used to build `{host}.hamreus.com`
 * image URLs. Hosts with weight <= 0 are skipped during host selection.
 */
export type ReaderHostConfig = {
  name: string;
  weight: number;
};

/**
 * Logical service that groups hosts (e.g. "自动" / "电信" / "联通"). The chapter
 * HTML's `curServ` index selects which service's host list to use.
 */
export type ReaderServiceConfig = {
  name: string;
  hosts: ReaderHostConfig[];
};

/**
 * Fully-resolved reader configuration derived from the live `config_*.js`
 * script. The reader viewer exposes `curServ`/`curHost` indexes that pin the
 * selected service and host at page load time.
 */
export type ReaderConfig = {
  curHost: number;
  curServ: number;
  services: ReaderServiceConfig[];
};

/**
 * Fallback reader config used when the external `config_*.js` script cannot be
 * fetched or parsed. Derived from Manhuagui's shipped defaults so that at least
 * one host candidate is always available for URL construction.
 */
export const DEFAULT_READER_CONFIG: ReaderConfig = {
  curHost: 0,
  curServ: 0,
  services: [
    {
      name: '自动',
      hosts: [
        { name: 'i', weight: 0.1 },
        { name: 'eu', weight: 4 },
        { name: 'eu1', weight: 4 },
        { name: 'eu2', weight: 4 },
        { name: 'us', weight: 1 },
        { name: 'us1', weight: 1 },
        { name: 'us2', weight: 1 },
        { name: 'us3', weight: 1 },
      ],
    },
    {
      name: '电信',
      hosts: [
        { name: 'eu', weight: 1 },
        { name: 'eu1', weight: 1 },
        { name: 'eu2', weight: 1 },
      ],
    },
    {
      name: '联通',
      hosts: [
        { name: 'us', weight: 1 },
        { name: 'us1', weight: 1 },
        { name: 'us2', weight: 1 },
        { name: 'us3', weight: 1 },
      ],
    },
  ],
};

const CONFIG_SCRIPT_URL_REGEX = /<script[^>]+src=["']([^"'<>]*\/scripts\/config_[^"'<>]+\.js)["'][^>]*>/i;

/**
 * Decode arbitrary response bytes using the encoding declared by the
 * `Content-Type` charset, defaulting to UTF-8. Used for the `config_*.js`
 * JavaScript response where we cannot rely on `<meta charset>` inspection.
 */
function decodeTextBytes(bytes: Uint8Array, contentType: string | null): string {
  const encodingMatch = contentType?.match(/charset\s*=\s*([^;\s]+)/i)?.[1];
  const encoding = sanitizeLabel(encodingMatch ?? '') || 'utf-8';

  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function extractConfigScriptUrl(chapterHtml: string): string | undefined {
  return toAbsoluteUrl(chapterHtml.match(CONFIG_SCRIPT_URL_REGEX)?.[1]);
}

function parseHostWeight(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Parse the inline JavaScript in `config_*.js` to extract the picserv service
 * list. Schema is brittle on purpose: we pin the exact `{name:"…",hosts:[…]}`
 * literal so we fail loudly (and fall back to {@link DEFAULT_READER_CONFIG})
 * if Manhuagui changes its config format.
 */
function parseReaderConfigScript(scriptText: string): ReaderConfig {
  const serviceMatches = [...scriptText.matchAll(/\{name:"([^"]+)",hosts:\[((?:\{h:"[^"]+",w:[0-9.]+\},?)+)\]\}/g)];
  if (serviceMatches.length === 0) {
    throw new Error('Manhuagui config format changed (picserv hosts missing)');
  }

  const services = serviceMatches.map((serviceMatch) => {
    const [, serviceName, hostsBlock] = serviceMatch;
    const hosts = [...(hostsBlock ?? '').matchAll(/\{h:"([^"]+)",w:([0-9.]+)\}/g)].map((hostMatch) => ({
      name: hostMatch[1] ?? '',
      weight: parseHostWeight(hostMatch[2] ?? '0'),
    })).filter((host) => host.name);

    if (!serviceName || hosts.length === 0) {
      throw new Error('Manhuagui config format changed (picserv host entry missing)');
    }

    return {
      name: serviceName,
      hosts,
    } satisfies ReaderServiceConfig;
  });

  const curServ = Number.parseInt(scriptText.match(/curServ:(\d+)/)?.[1] ?? '', 10);
  const curHost = Number.parseInt(scriptText.match(/curHost:(\d+)/)?.[1] ?? '', 10);

  return {
    curHost: Number.isFinite(curHost) ? curHost : 0,
    curServ: Number.isFinite(curServ) ? curServ : 0,
    services,
  };
}

/**
 * Fetch the current Manhuagui reader config by locating the `config_*.js`
 * script reference in chapter HTML and parsing it. Returns
 * {@link DEFAULT_READER_CONFIG} on any failure so image-URL construction can
 * still proceed with sensible defaults.
 */
export async function fetchReaderConfig(chapterHtml: string): Promise<ReaderConfig> {
  const configScriptUrl = extractConfigScriptUrl(chapterHtml);
  if (!configScriptUrl) {
    return DEFAULT_READER_CONFIG;
  }

  try {
    const response = await rateLimitedFetchByUrlScope(configScriptUrl, 'chapter');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    const scriptText = decodeTextBytes(new Uint8Array(buffer), response.headers.get('content-type'));
    return parseReaderConfigScript(scriptText);
  } catch (error) {
    logger.warn('[manhuagui] Failed to fetch or parse reader config script, using default host map', {
      configScriptUrl,
      error,
    });
    return DEFAULT_READER_CONFIG;
  }
}

/**
 * Pick the active image host from a {@link ReaderConfig}. Prefers
 * `curServ`/`curHost` when the selected host has non-zero weight, otherwise
 * falls back to the first host with weight > 0, then the first listed host.
 */
export function selectReaderHost(config: ReaderConfig): string {
  const service = config.services[config.curServ] ?? config.services[0] ?? DEFAULT_READER_CONFIG.services[0];
  if (!service) {
    throw new Error('Manhuagui config format changed (no image host services available)');
  }

  const currentHost = service.hosts[config.curHost];
  if (currentHost && currentHost.weight > 0) {
    return currentHost.name;
  }

  const firstAvailableHost = service.hosts.find((host) => host.weight > 0) ?? service.hosts[0];
  if (!firstAvailableHost) {
    throw new Error('Manhuagui config format changed (no image hosts available)');
  }

  return firstAvailableHost.name;
}
