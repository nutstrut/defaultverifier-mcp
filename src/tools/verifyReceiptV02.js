/**
 * verify_receipt_v02 — MCP tool: offline verification of Default Settlement
 * `0.2-candidate` receipts (profiles settlement-witness-verified-v0.2[-counterparty-bound]).
 *
 * Additive: the v0.1 `verify_receipt` and `verify_portable_sar_receipt` tools are untouched.
 * No network. Trust root is the bundled, pinned full-registry snapshot; there is no
 * caller-supplied key override and no refresh.
 *
 * Result shape is the shared contract (see lib/verifyV02.js). `receipt_valid` is the
 * receipt-validity result; `issuer_verdict` is the issuer's signed verdict and is
 * independent of it: a valid FAIL or INDETERMINATE receipt has receipt_valid=true.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildTrustIndex, parseReceiptText, resultForParseError, verifyReceipt, TrustPolicyError,
} from '../lib/verifyV02.js';

const _here = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(_here, '..', '..', 'keys', 'v02', 'sar-keys-v02-snapshot.json');
const PROVENANCE_PATH = join(_here, '..', '..', 'keys', 'v02', 'sar-keys-v02-snapshot.provenance.json');

let _trust = null;
export function loadBundledTrust() {
  if (_trust) return _trust;
  const raw = readFileSync(SNAPSHOT_PATH);
  const prov = JSON.parse(readFileSync(PROVENANCE_PATH, 'utf8'));
  const actual = createHash('sha256').update(raw).digest('hex');
  if (actual !== prov.sha256) throw new Error('bundled v0.2 trust snapshot does not match its recorded sha256');
  _trust = {
    index: buildTrustIndex(JSON.parse(raw.toString('utf8'))),
    provenance: { source: prov.source, fetched_on: prov.fetched_on, sha256: actual },
  };
  return _trust;
}

export const TOOL_DEFINITION = {
  name: 'verify_receipt_v02',
  description: [
    'Verify a Default Settlement v0.2-candidate receipt (receipt_version "0.2-candidate") locally: offline, no network, pinned key snapshot.',
    'Returns receipt_valid (signature, receipt_id and signed fields intact, key trusted for the profile) SEPARATELY from issuer_verdict (PASS/FAIL/INDETERMINATE as signed).',
    'A valid FAIL or INDETERMINATE receipt is still receipt_valid=true.',
    'Also returns the signed properties mapped to established/contradicted/not_established, the fields present outside the signature, and what the receipt does not imply.',
    'Does not verify v0.1 or portable SAR receipts (use verify_receipt / verify_portable_sar_receipt). Does not execute tasks, prove payment/legal finality, or endorse the issuer verdict.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      receipt: {
        description: 'The v0.2-candidate receipt: an object, or a JSON string (a string is parsed strictly and duplicate keys are rejected).',
        oneOf: [{ type: 'object' }, { type: 'string' }],
      },
    },
    required: ['receipt'],
    additionalProperties: false,
  },
};

export async function handleVerifyReceiptV02(args) {
  if (!args || args.receipt === undefined) throw new Error('receipt is required');
  const { index, provenance } = loadBundledTrust();
  if (typeof args.receipt === 'string') {
    const [value, err] = parseReceiptText(args.receipt);
    if (err) return resultForParseError(err, provenance);
    return verifyReceipt(value, index, provenance);
  }
  return verifyReceipt(args.receipt, index, provenance);
}

export { TrustPolicyError };
