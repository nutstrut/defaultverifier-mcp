/**
 * verify_portable_sar_receipt tool — MCP tool definition and handler.
 *
 * Verifies the original/portable six-field SAR v0.1 signed core (as also
 * implemented independently by xmandate/sar-sdk and documented at
 * sarprotocol.org). This is a SEPARATE tool from verify_receipt (which
 * verifies Default Settlement's wallet-bound receipts) -- neither tool's
 * handler calls the other, and this file does not import ../lib/sarVerifier.js.
 *
 * Unlike verify_receipt, there is no bundled default trust store: the
 * portable profile is inherently multi-issuer, so the caller MUST supply
 * an explicit key policy (kid -> {pubkey, profiles, source}).
 */

import { verifyPortableSarReceipt, STATUS } from '../lib/portableSarVerify.js';

export const TOOL_DEFINITION = {
  name: 'verify_portable_sar_receipt',
  description: [
    'Verify a Portable SAR v0.1 (six-field, original/portable profile) receipt locally (offline, no network).',
    'This is the profile also implemented by xmandate/sar-sdk and documented at sarprotocol.org --',
    'distinct from Default Settlement\'s own wallet-bound receipts (use verify_receipt for those).',
    'counterparty and _ext, if present, are ALWAYS reported as unsigned metadata and are never treated as an attested wallet binding.',
    'Requires an explicit key_policy (kid -> {pubkey_b64url, profiles, source}); there is no default trust store for this profile.',
    'Presence of receipt_version+sig_alg identifies a CANDIDATE profile only -- authorization additionally requires the key to be permitted for that profile.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      receipt: {
        description: 'The Portable SAR receipt to verify — either an object or a JSON string.',
        oneOf: [{ type: 'object' }, { type: 'string' }],
      },
      key_policy: {
        description:
          'Required. Map of verifier_kid -> {pubkey_b64url: string, profiles: string[], source: string}. ' +
          'No default/bundled trust store is used for this profile.',
        type: 'object',
      },
      requested_profile: {
        description: 'Optional. If supplied, must agree with the envelope-declared candidate profile; cannot override key/profile authorization.',
        type: 'string',
      },
    },
    required: ['receipt', 'key_policy'],
    additionalProperties: false,
  },
};

function makeKeyPolicy(keyPolicyObj) {
  return async (kid) => {
    const entry = keyPolicyObj[kid];
    if (!entry) return null;
    return {
      pubkey: entry.pubkey_b64url,
      profiles: new Set(entry.profiles || []),
      source: entry.source,
    };
  };
}

export async function handleVerifyPortableSarReceipt(args) {
  const { receipt: rawReceipt, key_policy: keyPolicyObj, requested_profile: requestedProfile = null } = args;

  let receipt;
  try {
    receipt = typeof rawReceipt === 'string' ? JSON.parse(rawReceipt) : rawReceipt;
  } catch (e) {
    return { status: STATUS.MALFORMED, reason: `could not parse receipt JSON: ${e.message}`, network_used: false };
  }

  if (!keyPolicyObj || typeof keyPolicyObj !== 'object') {
    return { status: STATUS.MALFORMED, reason: 'key_policy is required and must be an object', network_used: false };
  }

  const result = await verifyPortableSarReceipt(receipt, makeKeyPolicy(keyPolicyObj), requestedProfile);

  return { ...result, network_used: false };
}
