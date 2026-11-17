/**
 * verifyV02.js — offline verifier for Default Settlement receipts, profile family
 * `settlement-witness-verified-v0.2*`, `receipt_version: "0.2-candidate"`.
 *
 * JavaScript counterpart of defaultsettle-cli's `defaultsettle/verify_v02.py`.
 * The normative contract is specs/default-settlement-v02-verification/ in the Morpheus
 * repo; the shared JSON vectors (fixtures/v02/vectors.json) are the cross-language
 * contract, and this module must produce a result deep-equal to `expected_result`
 * for every vector.
 *
 * Pure: no network, no clock, no filesystem. Receipt validity is separate from the
 * issuer verdict. Unsigned fields never influence validity.
 */

import { createPublicKey, verify as edVerify, createHash } from 'node:crypto';

export const CONTRACT_ID = 'ds-v02-verification-contract/1';
export const RECEIPT_VERSION = '0.2-candidate';
const SIG_ALG = 'Ed25519';
const KEY_USE = 'sar_settlement_witness_signing';
export const GENERIC_PROFILE = 'settlement-witness-verified-v0.2';
export const COUNTERPARTY_BOUND_PROFILE = 'settlement-witness-verified-v0.2-counterparty-bound';

const GENERIC_CORE = ['receipt_profile', 'receipt_version', 'sig_alg', 'verdict', 'reason_code',
  'properties', 'verification_basis', 'verifier_kid', 'ts'];
const PROFILE_CORE_FIELDS = {
  [GENERIC_PROFILE]: GENERIC_CORE,
  [COUNTERPARTY_BOUND_PROFILE]: [...GENERIC_CORE, 'counterparty'],
};
const BASIS_FIELDS = ['evaluator_id', 'evaluator_version', 'evaluation_profile', 'policy_ref',
  'condition_digest', 'evidence_profile', 'evidence_digest', 'request_id', 'evaluated_at'];
const SIGNABLE_VERDICTS = ['PASS', 'FAIL', 'INDETERMINATE'];
const PROPERTY_STATES = ['pass', 'fail', 'unknown'];
const REQUIRED_PROPERTIES = ['declared_condition_satisfied', 'evidence_digest_binding',
  'runtime_execution_established', 'payment_finality_established', 'legal_finality_established'];
const VERDICT_TO_CONDITION_STATE = { PASS: 'pass', FAIL: 'fail', INDETERMINATE: 'unknown' };
const STATE_TO_BOUNDARY = { pass: 'established', fail: 'contradicted', unknown: 'not_established' };
const GATED_CLAIMS = {
  runtime_execution_established: 'runtime_execution',
  payment_finality_established: 'payment_finality',
  legal_finality_established: 'legal_finality',
};
const ALWAYS_NOT_IMPLIED = ['current_admissibility', 'external_effect', 'general_agent_safety',
  'endorsement', 'certification'];

const LEGACY_STATUS = {
  MALFORMED_JSON: null, DUPLICATE_KEY: null,
  MALFORMED_RECEIPT: 'REJECTED_MALFORMED', NOT_A_V02_RECEIPT: 'REJECTED_NOT_CANDIDATE',
  UNSUPPORTED_PROFILE: 'REJECTED_NOT_CANDIDATE', UNSUPPORTED_SIG_ALG: 'REJECTED_NOT_CANDIDATE',
  UNSUPPORTED_RECEIPT_VERSION: 'REJECTED_NOT_CANDIDATE', MISSING_FIELD: 'REJECTED_MALFORMED',
  FIELD_TYPE_INVALID: 'REJECTED_MALFORMED', VERDICT_INVALID: 'REJECTED_MALFORMED',
  PROPERTIES_INVALID: 'REJECTED_MALFORMED', VERIFICATION_BASIS_INVALID: 'REJECTED_MALFORMED',
  COUNTERPARTY_INVALID: 'REJECTED_MALFORMED', VERDICT_PROPERTY_INCONSISTENT: null,
  CANONICALIZATION_FAILED: 'REJECTED_MALFORMED', UNKNOWN_KEY: 'REJECTED_UNKNOWN_KEY',
  KEY_NOT_ACTIVE: null, KEY_USE_NOT_AUTHORIZED: null,
  PROFILE_NOT_AUTHORIZED: 'REJECTED_PROFILE_NOT_AUTHORIZED', RECEIPT_ID_MALFORMED: 'REJECTED_MALFORMED',
  RECEIPT_ID_MISMATCH: 'REJECTED_RECEIPT_ID_MISMATCH', SIGNATURE_MALFORMED: 'REJECTED_MALFORMED',
  SIGNATURE_INVALID: 'REJECTED_INVALID_SIGNATURE',
};

export const NON_CLAIMS = [
  'Receipt validity means the signature, receipt_id and signed fields are intact and the issuer key is trusted for this profile. It is not an endorsement of the issuer verdict.',
  "The issuer verdict is the issuer's signed statement about a declared condition against the bound evidence digest; this verifier does not re-evaluate it.",
  'Fields outside the signed core (including _unsigned and payment) are not covered by the signature and are reported only as unsigned_fields_present.',
  'Properties signed unknown are not established by this receipt; unknown is never false.',
];

const RECEIPT_ID_RE = /^sha256:[0-9a-f]{64}$/;
// Every SHA-256 digest string in the contract (receipt_id, condition_digest, evidence_digest) is
// exactly `sha256:` + 64 lowercase hex characters, matched against the WHOLE string. Length alone
// is not the rule: UTF-16 length (JavaScript) and code-point length (Python) disagree on astral text.
const DIGEST_RE = RECEIPT_ID_RE;
// Normative nesting cap, enforced identically in every implementation (SPEC section 3a).
// A container (object or array) at nesting depth > MAX_JSON_DEPTH is rejected; the outermost
// container is depth 1.
export const MAX_JSON_DEPTH = 64;
const SIG_BODY_RE = /^[A-Za-z0-9_-]{86}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

export class TrustPolicyError extends Error {}
class Reject extends Error {
  constructor(code, detail, extra = {}) { super(code); this.code = code; this.detail = detail; this.extra = extra; }
}
class CanonicalizationError extends Error {}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
// Same whitespace set as Python str.strip(), so both implementations agree on "empty".
const WS_ONLY = /^[\t\n\v\f\r \x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/;
const nonEmptyStr = (v) => isStr(v) && !WS_ONLY.test(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/** Sort by UTF-16 code unit (JS default), the order RFC 8785 uses for keys. */
const u16sorted = (items) => [...items].sort();
/** Own, enumerable data property even for the name `__proto__` (plain assignment would drop it). */
const setOwn = (obj, key, value) => {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
};

// ---------------------------------------------------------------------------
// RFC 8785 canonicalization (subset sufficient for signed cores; fail closed)
// ---------------------------------------------------------------------------

function hasLoneSurrogate(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (n >= 0xdc00 && n <= 0xdfff) { i++; continue; }
      return true;
    }
    if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}

function jcsString(s) {
  if (hasLoneSurrogate(s)) throw new CanonicalizationError('string is not valid Unicode');
  return JSON.stringify(s);
}

function jcsValue(v, depth = 0) {
  if (v === null) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'string') return jcsString(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || !Number.isInteger(v) || Math.abs(v) >= 2 ** 53) {
      throw new CanonicalizationError('non-integral, non-finite or unsafe number is not supported');
    }
    return String(v === 0 ? 0 : v);
  }
  if ((Array.isArray(v) || isObj(v)) && depth + 1 > MAX_JSON_DEPTH) {
    throw new CanonicalizationError('nesting exceeds the maximum depth');
  }
  if (Array.isArray(v)) return '[' + v.map((i) => jcsValue(i, depth + 1)).join(',') + ']';
  if (isObj(v)) {
    return '{' + Object.keys(v).sort().map((k) => jcsString(k) + ':' + jcsValue(v[k], depth + 1)).join(',') + '}';
  }
  throw new CanonicalizationError('unsupported JSON value type');
}

export function canonicalize(value) {
  try {
    return Buffer.from(jcsValue(value), 'utf8');
  } catch (e) {
    // defensive: the explicit depth cap should always fire first
    if (e instanceof RangeError) throw new CanonicalizationError('nesting exceeds the engine limit');
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Strict base64url
// ---------------------------------------------------------------------------

export function decodeBase64urlStrict(body) {
  if (!isStr(body) || !B64URL_RE.test(body) || body.length % 4 === 1) throw new Error('not strict unpadded base64url');
  const raw = Buffer.from(body, 'base64url');
  if (raw.toString('base64url') !== body) throw new Error('non-canonical base64url');
  return raw;
}

// ---------------------------------------------------------------------------
// Strict JSON text parser: rejects duplicate keys and any non-JSON syntax
// ---------------------------------------------------------------------------

class ParseError extends Error { constructor(code) { super(code); this.code = code; } }

const NUMBER_RE = /-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/y;

/** True if the text nests containers deeper than `limit`. String-aware, linear and syntax-agnostic;
 * identical in every implementation, so a depth rejection is the same everywhere. */
function jsonDepthExceeds(text, limit) {
  let depth = 0; let inString = false; let escaped = false;
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '[' || ch === '{') { depth++; if (depth > limit) return true; }
    else if (ch === ']' || ch === '}') depth--;
  }
  return false;
}

function strictParse(text) {
  if (jsonDepthExceeds(text, MAX_JSON_DEPTH)) throw new ParseError('MALFORMED_JSON');
  let i = 0;
  const ws = () => { while (i < text.length && ' \t\n\r'.includes(text[i])) i++; };
  const fail = () => { throw new ParseError('MALFORMED_JSON'); };
  function value() {
    ws();
    const c = text[i];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string();
    if (c === 't' && text.startsWith('true', i)) { i += 4; return true; }
    if (c === 'f' && text.startsWith('false', i)) { i += 5; return false; }
    if (c === 'n' && text.startsWith('null', i)) { i += 4; return null; }
    return number();
  }
  function number() {
    NUMBER_RE.lastIndex = i;
    const m = NUMBER_RE.exec(text);
    if (!m) fail();
    i += m[0].length;
    return Number(m[0]);
  }
  function string() {
    const start = i;
    i++;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') { i++; return JSON.parse(text.slice(start, i)); }
      if (c < ' ') fail();
      if (c === '\\') {
        i++;
        if (text[i] === 'u') { if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) fail(); i += 5; continue; }
        if (!'"\\/bfnrt'.includes(text[i] ?? '#')) fail();
      }
      i++;
    }
    return fail();
  }
  function array() {
    i++; const out = []; ws();
    if (text[i] === ']') { i++; return out; }
    for (;;) {
      out.push(value()); ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === ']') { i++; return out; }
      fail();
    }
  }
  function object() {
    i++; const out = {}; const seen = new Set(); ws();
    if (text[i] === '}') { i++; return out; }
    for (;;) {
      ws();
      if (text[i] !== '"') fail();
      const k = string();
      if (seen.has(k)) throw new ParseError('DUPLICATE_KEY');
      seen.add(k);
      ws();
      if (text[i] !== ':') fail();
      i++;
      Object.defineProperty(out, k, { value: value(), enumerable: true, writable: true, configurable: true });
      ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === '}') { i++; return out; }
      fail();
    }
  }
  const v = value();
  ws();
  if (i !== text.length) fail();
  return v;
}

export function parseReceiptText(text) {
  try {
    return [strictParse(text), null];
  } catch (e) {
    if (e instanceof ParseError && e.code === 'DUPLICATE_KEY') {
      return [null, ['DUPLICATE_KEY', 'receipt JSON contains a duplicate object key']];
    }
    return [null, ['MALFORMED_JSON', 'input is not valid JSON']];
  }
}

// ---------------------------------------------------------------------------
// Trust index
// ---------------------------------------------------------------------------

export function buildTrustIndex(registry) {
  if (!isObj(registry) || !Array.isArray(registry.keys)) {
    throw new TrustPolicyError("registry must be an object with a 'keys' list");
  }
  const index = new Map();
  for (const entry of registry.keys) {
    if (!isObj(entry) || !nonEmptyStr(entry.kid)) throw new TrustPolicyError('registry entry without a string kid');
    if (index.has(entry.kid)) throw new TrustPolicyError('duplicate kid in registry');
    let pubkey = null;
    try {
      let px = null; let ph = null;
      if (has(entry, 'x')) px = decodeBase64urlStrict(entry.x);
      if (has(entry, 'public_key_hex')) {
        if (!(isStr(entry.public_key_hex) && /^[0-9a-f]{64}$/.test(entry.public_key_hex))) throw new Error('bad hex');
        ph = Buffer.from(entry.public_key_hex, 'hex');
      }
      if (px !== null && ph !== null && !px.equals(ph)) pubkey = null;
      else pubkey = px !== null ? px : ph;
      if (pubkey !== null && pubkey.length !== 32) pubkey = null;
    } catch { pubkey = null; }
    index.set(entry.kid, {
      pubkey,
      status: has(entry, 'status') ? entry.status : null,
      use: has(entry, 'use') ? entry.use : null,
      profiles: new Set(Array.isArray(entry.profiles) ? entry.profiles : []),
    });
  }
  return index;
}

const keyCurrency = (status) => (status === 'active' ? 'current' : status === 'retired' ? 'historical' : 'unstated');

// ---------------------------------------------------------------------------
// Result construction
// ---------------------------------------------------------------------------

const CHECKS = ['structure', 'profile_and_version', 'required_fields', 'signed_field_types',
  'verdict_property_consistency', 'key_lookup', 'key_status', 'key_use', 'profile_authorization',
  'receipt_id_binding', 'signature_encoding', 'signature'];
const CODE_TO_CHECK = {
  MALFORMED_JSON: 'structure', DUPLICATE_KEY: 'structure', MALFORMED_RECEIPT: 'structure',
  NOT_A_V02_RECEIPT: 'profile_and_version', UNSUPPORTED_PROFILE: 'profile_and_version',
  UNSUPPORTED_SIG_ALG: 'profile_and_version', UNSUPPORTED_RECEIPT_VERSION: 'profile_and_version',
  MISSING_FIELD: 'required_fields', COUNTERPARTY_INVALID: 'signed_field_types',
  FIELD_TYPE_INVALID: 'signed_field_types', VERDICT_INVALID: 'signed_field_types',
  PROPERTIES_INVALID: 'signed_field_types', VERIFICATION_BASIS_INVALID: 'signed_field_types',
  VERDICT_PROPERTY_INCONSISTENT: 'verdict_property_consistency',
  CANONICALIZATION_FAILED: 'receipt_id_binding', UNKNOWN_KEY: 'key_lookup', KEY_NOT_ACTIVE: 'key_status',
  KEY_USE_NOT_AUTHORIZED: 'key_use', PROFILE_NOT_AUTHORIZED: 'profile_authorization',
  RECEIPT_ID_MALFORMED: 'receipt_id_binding', RECEIPT_ID_MISMATCH: 'receipt_id_binding',
  SIGNATURE_MALFORMED: 'signature_encoding', SIGNATURE_INVALID: 'signature',
};

function checksFor(failedCode) {
  if (failedCode === null) return CHECKS.map((check) => ({ check, result: 'pass' }));
  const failed = CODE_TO_CHECK[failedCode];
  let hit = false;
  return CHECKS.map((check) => {
    if (hit) return { check, result: 'not_run' };
    if (check === failed) { hit = true; return { check, result: 'fail' }; }
    return { check, result: 'pass' };
  });
}

const strOrNull = (v) => (isStr(v) ? v : null);

function emptyResult(receipt, provenance) {
  const r = isObj(receipt) ? receipt : {};
  return {
    verifier: { contract: CONTRACT_ID, supported_receipt_version: RECEIPT_VERSION, network_access: false },
    receipt_valid: false,
    receipt: {
      receipt_version: strOrNull(r.receipt_version),
      receipt_profile: strOrNull(r.receipt_profile),
      receipt_id: strOrNull(r.receipt_id),
      computed_receipt_id: null,
    },
    checks: [],
    issuer: {
      kid: strOrNull(r.verifier_kid), key_known: false, key_status: null, key_use: null,
      key_currency: null, profile_authorized: null,
      trust_snapshot: provenance ? { ...provenance } : null,
    },
    issuer_verdict: null,
    signed_properties: null,
    boundary: null,
    unsigned_fields_present: [],
    rejection: null,
    non_claims: [...NON_CLAIMS],
  };
}

function boundary(props) {
  const mapped = {};
  for (const n of u16sorted(Object.keys(props))) setOwn(mapped, n, STATE_TO_BOUNDARY[props[n]]);
  const notImplied = [...ALWAYS_NOT_IMPLIED];
  for (const [prop, claim] of Object.entries(GATED_CLAIMS)) if (props[prop] !== 'pass') notImplied.push(claim);
  const by = (s) => u16sorted(Object.keys(mapped).filter((n) => mapped[n] === s));
  return {
    properties: mapped,
    established: by('established'),
    contradicted: by('contradicted'),
    not_established: by('not_established'),
    not_implied: u16sorted(notImplied),
  };
}

// ---------------------------------------------------------------------------
// The verifier
// ---------------------------------------------------------------------------

export function verifyReceipt(receipt, trustIndex, provenance = null) {
  const result = emptyResult(receipt, provenance);
  try {
    verifyInner(receipt, trustIndex, result);
  } catch (e) {
    if (!(e instanceof Reject)) throw e;
    result.rejection = { code: e.code, detail: e.detail, legacy_status: LEGACY_STATUS[e.code], ...e.extra };
    result.checks = checksFor(e.code);
    result.receipt_valid = false;
    result.issuer_verdict = null;
    result.signed_properties = null;
    result.boundary = null;
  }
  return result;
}

export function verifyReceiptText(text, registry, provenance = null) {
  const index = buildTrustIndex(registry);
  const [value, err] = parseReceiptText(text);
  if (err) return resultForParseError(err, provenance);
  return verifyReceipt(value, index, provenance);
}

export function resultForParseError(err, provenance = null) {
  const result = emptyResult(null, provenance);
  result.rejection = { code: err[0], detail: err[1], legacy_status: null };
  result.checks = checksFor(err[0]);
  return result;
}

function verifyInner(receipt, trustIndex, result) {
  if (!isObj(receipt)) throw new Reject('MALFORMED_RECEIPT', 'receipt is not a JSON object');

  const profile = receipt.receipt_profile;
  if (!isStr(profile)) throw new Reject('NOT_A_V02_RECEIPT', 'receipt does not declare a receipt_profile');
  const coreFields = has(PROFILE_CORE_FIELDS, profile) ? PROFILE_CORE_FIELDS[profile] : null;
  if (coreFields === null) throw new Reject('UNSUPPORTED_PROFILE', 'receipt_profile is not a supported v0.2 profile');
  result.unsigned_fields_present = u16sorted(
    Object.keys(receipt).filter((k) => !coreFields.includes(k) && k !== 'receipt_id' && k !== 'sig'),
  );
  if (receipt.sig_alg !== SIG_ALG) throw new Reject('UNSUPPORTED_SIG_ALG', 'sig_alg is not Ed25519');
  // Literal, exact match. "0.2-candidate" is not aliased to or normalised from anything.
  if (receipt.receipt_version !== RECEIPT_VERSION) {
    throw new Reject('UNSUPPORTED_RECEIPT_VERSION', "receipt_version is not exactly '0.2-candidate'");
  }

  const missing = [...coreFields, 'receipt_id', 'sig'].filter((f) => !has(receipt, f));
  if (missing.length) throw new Reject('MISSING_FIELD', 'required field(s) absent', { fields: missing });

  const verdict = receipt.verdict;
  if (!isStr(verdict) || !SIGNABLE_VERDICTS.includes(verdict)) {
    throw new Reject('VERDICT_INVALID', 'verdict is outside the signable domain');
  }
  for (const f of ['reason_code', 'verifier_kid', 'ts']) {
    if (!nonEmptyStr(receipt[f])) throw new Reject('FIELD_TYPE_INVALID', 'signed string field missing or empty', { fields: [f] });
  }

  const props = receipt.properties;
  if (!isObj(props)) throw new Reject('PROPERTIES_INVALID', 'properties is not an object');
  const absent = REQUIRED_PROPERTIES.filter((p) => !has(props, p));
  if (absent.length) throw new Reject('PROPERTIES_INVALID', 'required property absent', { fields: absent });
  const bad = u16sorted(Object.keys(props).filter((n) => !isStr(props[n]) || !PROPERTY_STATES.includes(props[n])));
  if (bad.length) throw new Reject('PROPERTIES_INVALID', 'property state outside pass/fail/unknown', { fields: bad });

  const basis = receipt.verification_basis;
  if (!isObj(basis)) throw new Reject('VERIFICATION_BASIS_INVALID', 'verification_basis is not an object');
  const missingBasis = BASIS_FIELDS.filter((f) => !has(basis, f));
  if (missingBasis.length) throw new Reject('VERIFICATION_BASIS_INVALID', 'verification_basis field absent', { fields: missingBasis });
  const badBasis = BASIS_FIELDS.filter((f) => !nonEmptyStr(basis[f]));
  for (const f of ['condition_digest', 'evidence_digest']) {
    const v = basis[f];
    if (!badBasis.includes(f) && !DIGEST_RE.test(v)) badBasis.push(f);
  }
  if (badBasis.length) {
    throw new Reject('VERIFICATION_BASIS_INVALID', 'verification_basis field empty or malformed', { fields: u16sorted(badBasis) });
  }

  if (coreFields.includes('counterparty') && !nonEmptyStr(receipt.counterparty)) {
    throw new Reject('COUNTERPARTY_INVALID', 'counterparty-bound profile requires a non-empty counterparty');
  }

  if (props.declared_condition_satisfied !== VERDICT_TO_CONDITION_STATE[verdict]) {
    throw new Reject('VERDICT_PROPERTY_INCONSISTENT', 'verdict disagrees with declared_condition_satisfied');
  }

  const core = {};
  for (const f of coreFields) core[f] = receipt[f];
  let digest;
  try {
    digest = createHash('sha256').update(canonicalize(core)).digest();
  } catch (e) {
    if (e instanceof CanonicalizationError) throw new Reject('CANONICALIZATION_FAILED', 'signed core cannot be canonicalized');
    throw e;
  }
  const expectedId = 'sha256:' + digest.toString('hex');
  result.receipt.computed_receipt_id = expectedId;

  const kid = receipt.verifier_kid;
  const entry = trustIndex.get(kid);
  if (entry === undefined || entry.pubkey === null) {
    throw new Reject('UNKNOWN_KEY', 'verifier_kid is not in the pinned trust snapshot or its key material is unusable');
  }
  const issuer = result.issuer;
  issuer.key_known = true;
  issuer.key_status = entry.status;
  issuer.key_use = entry.use;
  issuer.key_currency = keyCurrency(entry.status);

  if (entry.status !== null && entry.status !== 'active' && entry.status !== 'retired') {
    throw new Reject('KEY_NOT_ACTIVE', 'key lifecycle status does not permit signing authority');
  }
  if (entry.use !== null && entry.use !== KEY_USE) {
    throw new Reject('KEY_USE_NOT_AUTHORIZED', 'key use is present and is not sar_settlement_witness_signing');
  }
  if (!entry.profiles.has(profile)) {
    issuer.profile_authorized = false;
    throw new Reject('PROFILE_NOT_AUTHORIZED', 'key is known but not authorized for this receipt_profile');
  }
  issuer.profile_authorized = true;

  const rid = receipt.receipt_id;
  if (!isStr(rid) || !RECEIPT_ID_RE.test(rid)) throw new Reject('RECEIPT_ID_MALFORMED', 'receipt_id is not sha256:<64 lowercase hex>');
  if (rid !== expectedId) throw new Reject('RECEIPT_ID_MISMATCH', 'receipt_id does not match the digest of the signed core');

  const sig = receipt.sig;
  if (!isStr(sig) || !sig.startsWith('base64url:') || !SIG_BODY_RE.test(sig.slice(10))) {
    throw new Reject('SIGNATURE_MALFORMED', 'sig is not base64url:<86 strict unpadded base64url characters>');
  }
  let sigBytes;
  try { sigBytes = decodeBase64urlStrict(sig.slice(10)); } catch { throw new Reject('SIGNATURE_MALFORMED', 'sig is not canonical base64url'); }
  let ok = false;
  try {
    // Ed25519 is verified over the 32 SHA-256 digest bytes, not the canonical bytes.
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), entry.pubkey]);
    const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    ok = edVerify(null, digest, key, sigBytes);
  } catch { ok = false; }
  if (!ok) throw new Reject('SIGNATURE_INVALID', 'Ed25519 signature does not verify');

  result.receipt_valid = true;
  result.checks = checksFor(null);
  result.issuer_verdict = { verdict, reason_code: receipt.reason_code };
  result.signed_properties = {};
  for (const k of u16sorted(Object.keys(props))) setOwn(result.signed_properties, k, props[k]);
  result.boundary = boundary(props);
}
