/**
 * get_verification_log tool — read DefaultVerifier's local verified.json log.
 *
 * Phase A: local file only. No network calls.
 * Source: /var/www/html/verified.json (production log on this VPS).
 * Preserves the disclaimer / non-endorsement language from the file.
 */

import { readFileSync } from 'fs';
import { LOG_DOES_NOT_PROVE } from '../lib/boundaries.js';

const LOCAL_LOG_PATH = process.env.VERIFIED_LOG_PATH || '/var/www/html/verified.json';

export const TOOL_DEFINITION = {
  name: 'get_verification_log',
  description: [
    'Return entries from DefaultVerifier\'s machine-readable verification log.',
    'Source: local /var/www/html/verified.json (Phase A — no network).',
    'Listing is NOT partnership, adoption, endorsement, standardization, or official integration.',
    'Each entry describes a public artifact that was independently verified.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        description: 'Maximum number of entries to return.',
        type: 'integer',
        default: 10,
        minimum: 1,
        maximum: 100,
      },
      kind: {
        description: 'Optional filter: only return entries matching this kind/type field.',
        type: 'string',
      },
      since: {
        description: 'Optional ISO 8601 date — only return entries with verified_at >= since.',
        type: 'string',
      },
    },
    additionalProperties: false,
  },
};

export async function handleGetVerificationLog(args) {
  const { limit = 10, kind, since } = args;

  let raw;
  try {
    raw = readFileSync(LOCAL_LOG_PATH, 'utf8');
  } catch (e) {
    return {
      status: 'INDETERMINATE',
      network_used: false,
      source: LOCAL_LOG_PATH,
      entries: [],
      disclaimer: null,
      warnings: [`Could not read local log at ${LOCAL_LOG_PATH}: ${e.message}`],
      errors: [],
      boundary: { does_not_prove: LOG_DOES_NOT_PROVE },
    };
  }

  let logData;
  try {
    logData = JSON.parse(raw);
  } catch (e) {
    return {
      status: 'ERROR',
      network_used: false,
      source: LOCAL_LOG_PATH,
      entries: [],
      disclaimer: null,
      warnings: [],
      errors: [`Could not parse verified.json: ${e.message}`],
      boundary: { does_not_prove: LOG_DOES_NOT_PROVE },
    };
  }

  const disclaimer = logData.disclaimer || null;
  let entries = Array.isArray(logData.entries) ? logData.entries : [];

  // Filter by kind
  if (kind) {
    entries = entries.filter(e => e.kind === kind || e.type === kind);
  }

  // Filter by since date
  if (since) {
    const sinceDate = new Date(since);
    if (!isNaN(sinceDate)) {
      entries = entries.filter(e => {
        const d = new Date(e.verified_at || e.ts || e.date || 0);
        return d >= sinceDate;
      });
    }
  }

  // Apply limit
  entries = entries.slice(0, limit);

  return {
    status: 'PASS',
    network_used: false,
    source: LOCAL_LOG_PATH,
    entries,
    disclaimer,
    warnings: [],
    errors: [],
    boundary: { does_not_prove: LOG_DOES_NOT_PROVE },
  };
}
