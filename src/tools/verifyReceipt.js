/**
 * verify_receipt tool — MCP tool definition and handler.
 *
 * Verifies a signed SAR v0.1 receipt locally. No network calls.
 * status = verification tool result; verdict = issuer's signed outcome.
 * A cryptographically valid FAIL receipt returns { status:"PASS", verdict:"FAIL" }.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { verifyReceipt as _verify } from '../lib/sarVerifier.js';
import {
  VERIFY_RECEIPT_PROVES,
  VERIFY_RECEIPT_DOES_NOT_PROVE,
} from '../lib/boundaries.js';

const _here = dirname(fileURLToPath(import.meta.url));
const _repoRoot = join(_here, '..', '..');
const _defaultKeysPath = join(_repoRoot, 'keys', 'sar-keys.json');

let _cachedKeys = null;
function loadBundledKeys() {
  if (!_cachedKeys) {
    _cachedKeys = JSON.parse(readFileSync(_defaultKeysPath, 'utf8'));
  }
  return _cachedKeys;
}

export const TOOL_DEFINITION = {
  name: 'verify_receipt',
  description: [
    'Verify a signed SAR v0.1 settlement receipt locally (offline, no network).',
    'Returns a typed result: status=PASS means the signature and digest are cryptographically valid.',
    'The verdict field carries the issuer-signed outcome (PASS/FAIL/INDETERMINATE) from the receipt itself.',
    'A valid FAIL receipt → { status:"PASS", verdict:"FAIL" }.',
    'A tampered receipt → { status:"INVALID" }.',
    'DefaultVerifier verifies evidence. It does not execute tasks, approve actions,',
    'release funds, custody funds, or prove payment/legal finality.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      receipt: {
        description: 'The SAR v0.1 receipt to verify — either an object or a JSON string.',
        oneOf: [{ type: 'object' }, { type: 'string' }],
      },
      keys: {
        description: 'Optional key registry object to use instead of the bundled keys.',
        type: 'object',
      },
      refresh_keys: {
        description: 'Must be false or omitted. Network key refresh is not implemented in Phase A.',
        type: 'boolean',
        default: false,
      },
    },
    required: ['receipt'],
    additionalProperties: false,
  },
};

export async function handleVerifyReceipt(args) {
  const { receipt: rawReceipt, keys: userKeys, refresh_keys = false } = args;

  if (refresh_keys === true) {
    return _errorResult(
      'not_implemented',
      'refresh_keys=true is not implemented in Phase A. Network key refresh is deferred to a later phase. Use the bundled key registry (keys_source: "bundled").',
    );
  }

  let receipt;
  try {
    receipt = typeof rawReceipt === 'string' ? JSON.parse(rawReceipt) : rawReceipt;
  } catch (e) {
    return _errorResult('parse_error', `could not parse receipt JSON: ${e.message}`);
  }

  let keysData;
  try {
    keysData = userKeys && typeof userKeys === 'object' ? userKeys : loadBundledKeys();
  } catch (e) {
    return _errorResult('keys_load_error', `could not load key registry: ${e.message}`);
  }

  const result = _verify(receipt, keysData);

  return {
    status: result.status,
    checks: result.checks,
    receipt_id: result.receipt_id,
    canonical_digest: result.canonical_digest,
    kid: result.kid,
    issuer: result.issuer,
    verdict: result.verdict,
    confidence: result.confidence,
    reason_code: result.reason_code,
    ts: result.ts,
    evidence_refs: result.evidence_refs,
    warnings: result.warnings,
    errors: result.errors,
    network_used: false,
    keys_source: userKeys ? 'caller_provided' : 'bundled',
    boundary: {
      proves: VERIFY_RECEIPT_PROVES,
      does_not_prove: VERIFY_RECEIPT_DOES_NOT_PROVE,
    },
  };
}

function _errorResult(code, message) {
  return {
    status: 'ERROR',
    checks: {
      receipt_parsed: false,
      core_fields_present: false,
      canonicalization: 'rfc8785-jcs',
      receipt_id_valid: false,
      valid_signature: false,
      kid_in_registry: false,
    },
    receipt_id: null,
    canonical_digest: null,
    kid: null,
    issuer: null,
    verdict: null,
    confidence: 0.0,
    reason_code: code,
    ts: new Date().toISOString(),
    evidence_refs: [],
    warnings: [],
    errors: [message],
    network_used: false,
    keys_source: 'bundled',
    boundary: {
      proves: VERIFY_RECEIPT_PROVES,
      does_not_prove: VERIFY_RECEIPT_DOES_NOT_PROVE,
    },
  };
}
