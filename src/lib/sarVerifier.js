/**
 * sarVerifier.js — Local-first SAR v0.1 receipt verifier.
 *
 * Verifies a signed SAR v0.1 receipt entirely offline. No network calls.
 * Ported from verify_receipt.py (DefaultVerifier / SettlementWitness v0.1.1).
 *
 * Canonicalization: RFC 8785 / JCS via the 'canonicalize' npm package.
 * Ed25519 verification: Node.js built-in crypto (no private-key material here).
 */

import { createHash, verify as cryptoVerify, createPublicKey } from 'crypto';
import canonicalize from 'canonicalize';

// Signed-core field set for SAR v0.1. Mirrors Python's _CORE_REQUIRED.
// Only these fields are canonicalized and signed; non-core fields (sar_version,
// notes, attribution) must NOT affect the digest.
const CORE_REQUIRED = ['task_id_hash', 'verdict', 'confidence', 'reason_code', 'ts', 'verifier_kid'];

/**
 * Flexible base64url decode (tolerant of missing padding, same as Python port).
 */
function b64urlDecode(s) {
  s = (s || '').trim().replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4 !== 0) s += '=';
  return Buffer.from(s, 'base64');
}

/**
 * Wrap a raw 32-byte Ed25519 public key in SubjectPublicKeyInfo DER format
 * so Node's crypto.createPublicKey can consume it.
 *
 * DER structure (RFC 5958 / RFC 8410):
 *   SEQUENCE {
 *     SEQUENCE { OID 1.3.101.112 }    -- Ed25519
 *     BIT STRING { 0x00 || rawKey }
 *   }
 * Hex prefix: 302a300506032b6570032100 (12 bytes)
 */
function rawEd25519ToPublicKey(rawBytes) {
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  const der = Buffer.concat([prefix, rawBytes]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

/**
 * Look up a public key by kid in the loaded key registry object.
 */
function getPublicKeyForKid(kid, keysData) {
  const entry = (keysData.keys || []).find(k => k.kid === kid);
  if (!entry) throw new Error(`verifier_kid not found in registry: ${kid}`);
  const rawBytes = b64urlDecode(entry.x);
  if (rawBytes.length !== 32) {
    throw new Error(`invalid Ed25519 public key length: ${rawBytes.length} bytes (expected 32)`);
  }
  return rawEd25519ToPublicKey(rawBytes);
}

/**
 * Build the signed core object from a receipt. Mirrors Python's _core_without_sig.
 * Optional counterparty is included only when present and non-empty.
 */
function buildCore(receipt) {
  const core = {
    task_id_hash: receipt.task_id_hash,
    verdict: receipt.verdict,
    confidence: receipt.confidence,
    reason_code: receipt.reason_code,
    ts: receipt.ts,
    verifier_kid: receipt.verifier_kid,
  };
  if (typeof receipt.counterparty === 'string' && receipt.counterparty.trim()) {
    core.counterparty = receipt.counterparty.trim();
  }
  return core;
}

/**
 * Compute (canonicalBytes, sha256DigestBuffer) for a core object.
 * Canonicalization is RFC 8785 / JCS — same rule the issuer signs.
 */
function digestForCore(core) {
  const canonical = canonicalize(core); // returns a string
  if (canonical === undefined) throw new Error('canonicalize returned undefined');
  const canonicalBytes = Buffer.from(canonical, 'utf8');
  const digest = createHash('sha256').update(canonicalBytes).digest();
  return { canonicalBytes, digest };
}

/**
 * Verify a SAR v0.1 receipt fully offline.
 *
 * @param {object} receipt  — parsed receipt object
 * @param {object} keysData — parsed sar-keys.json content
 * @returns {object} verification result with all check fields
 */
export function verifyReceipt(receipt, keysData) {
  const errors = [];
  const warnings = [];
  const checks = {
    receipt_parsed: false,
    core_fields_present: false,
    canonicalization: 'rfc8785-jcs',
    receipt_id_valid: false,
    valid_signature: false,
    kid_in_registry: false,
  };

  const rid = typeof receipt === 'object' && receipt !== null ? receipt.receipt_id : null;
  const kid = typeof receipt === 'object' && receipt !== null ? receipt.verifier_kid : null;
  const verdict = typeof receipt === 'object' && receipt !== null ? receipt.verdict : null;
  const issuer = typeof receipt === 'object' && receipt !== null ? (receipt.issuer || 'defaultverifier.com') : null;

  if (typeof receipt !== 'object' || receipt === null || Array.isArray(receipt)) {
    errors.push('receipt is not a JSON object');
    return _result('ERROR', checks, rid, null, kid, issuer, verdict, errors, warnings);
  }

  checks.receipt_parsed = true;

  const sig = receipt.sig;

  // Structural checks
  if (!(typeof rid === 'string' && rid.startsWith('sha256:'))) {
    errors.push("receipt_id missing required 'sha256:' prefix");
  }
  if (!(typeof sig === 'string' && sig.startsWith('base64url:'))) {
    errors.push("sig missing required 'base64url:' prefix");
  }
  if (!(typeof kid === 'string' && kid.trim())) {
    errors.push('verifier_kid missing');
  }
  for (const field of CORE_REQUIRED) {
    if (receipt[field] === undefined || receipt[field] === null) {
      errors.push(`missing required core field: ${field}`);
    }
  }

  if (errors.length > 0) {
    return _result('INVALID', checks, rid, null, kid, issuer, verdict, errors, warnings);
  }

  checks.core_fields_present = true;

  // Check kid is in registry
  const kidInRegistry = (keysData.keys || []).some(k => k.kid === kid.trim());
  checks.kid_in_registry = kidInRegistry;
  if (!kidInRegistry) {
    errors.push(`verifier_kid not found in key registry: ${kid}`);
  }

  // Canonicalize and compute digest
  const core = buildCore(receipt);
  let canonicalHex = null;
  let digestHex = null;
  let digest = null;

  try {
    const { canonicalBytes, digest: d } = digestForCore(core);
    digest = d;
    canonicalHex = canonicalBytes.toString('hex');
    digestHex = d.toString('hex');
  } catch (e) {
    errors.push(`canonicalization failed: ${e.message}`);
    return _result('INVALID', checks, rid, null, kid, issuer, verdict, errors, warnings);
  }

  // Verify receipt_id == "sha256:" + hex(sha256(canonical))
  const expectedRid = `sha256:${digestHex}`;
  checks.receipt_id_valid = rid === expectedRid;
  if (!checks.receipt_id_valid) {
    errors.push(`receipt_id does not match canonical digest (expected ${expectedRid})`);
  }

  const canonicalDigest = `sha256:${digestHex}`;

  // Ed25519 signature over the digest bytes
  if (kidInRegistry) {
    try {
      const sigPayload = sig.split(':', 1)[0] === 'base64url' ? sig.slice('base64url:'.length) : sig;
      const sigBytes = b64urlDecode(sigPayload);
      const pubKey = getPublicKeyForKid(kid.trim(), keysData);
      // Sign over digest bytes (same as Python: pub.verify(sig_bytes, digest))
      checks.valid_signature = cryptoVerify(null, digest, pubKey, sigBytes);
      if (!checks.valid_signature) {
        errors.push('signature verification failed: signature does not match');
      }
    } catch (e) {
      checks.valid_signature = false;
      errors.push(`signature verification failed: ${e.message}`);
    }
  }

  const allChecksPassed = checks.receipt_id_valid && checks.valid_signature && checks.kid_in_registry;

  if (!allChecksPassed) {
    return _result('INVALID', checks, rid, canonicalDigest, kid, issuer, verdict, errors, warnings);
  }

  // Cryptographic verification passed. status=PASS means our verification tool
  // confirmed the receipt is authentic. verdict comes from the signed payload.
  return _result('PASS', checks, rid, canonicalDigest, kid, issuer, verdict, errors, warnings);
}

function _result(status, checks, rid, canonicalDigest, kid, issuer, verdict, errors, warnings) {
  // Determine confidence from checks
  let confidence = null;
  if (status === 'PASS') confidence = 1.0;
  else if (status === 'INDETERMINATE') confidence = 0.0;
  else confidence = 0.0;

  // reason_code based on check outcomes
  let reasonCode = 'UNKNOWN';
  if (status === 'PASS') reasonCode = 'MATCH';
  else if (checks.receipt_id_valid === false || checks.valid_signature === false) reasonCode = 'MISMATCH';
  else if (status === 'INDETERMINATE') reasonCode = 'INDETERMINATE';
  else if (status === 'ERROR') reasonCode = 'PARSE_ERROR';

  return {
    status,
    checks,
    receipt_id: rid || null,
    canonical_digest: canonicalDigest || null,
    kid: (kid && typeof kid === 'string') ? kid.trim() : null,
    issuer: issuer || 'defaultverifier.com',
    verdict: verdict || null,
    confidence,
    reason_code: reasonCode,
    ts: new Date().toISOString(),
    evidence_refs: [],
    warnings,
    errors,
    network_used: false,
    keys_source: 'bundled',
  };
}
