/**
 * self-test-v02.js — drives the shared language-neutral vector suite through the JS
 * v0.2 verifier and the verify_receipt_v02 tool. Every vector's result must be
 * deep-equal to the `expected_result` produced by the reference (Python) core.
 * No network.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import net from 'node:net';
import {
  buildTrustIndex, parseReceiptText, resultForParseError, verifyReceipt, canonicalize, MAX_JSON_DEPTH, TrustPolicyError,
} from '../src/lib/verifyV02.js';
import { handleVerifyReceiptV02, loadBundledTrust, TOOL_DEFINITION } from '../src/tools/verifyReceiptV02.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fx = join(root, 'fixtures', 'v02');
const suite = JSON.parse(readFileSync(join(fx, 'vectors.json'), 'utf8'));

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { console.error(`FAIL: ${name}\n${e.stack}`); process.exitCode = 1; }
}
async function atest(name, fn) {
  try { await fn(); passed++; } catch (e) { console.error(`FAIL: ${name}\n${e.stack}`); process.exitCode = 1; }
}

const prodRegistry = JSON.parse(readFileSync(join(fx, 'sar-keys-snapshot.json'), 'utf8'));
const indexes = {};
for (const [name, pol] of Object.entries(suite.trust_policies)) {
  indexes[name] = buildTrustIndex(pol.registry ?? prodRegistry);
}
function run(c) {
  const prov = suite.trust_policies[c.trust_policy].provenance;
  if ('receipt_raw' in c) {
    const [value, err] = parseReceiptText(c.receipt_raw);
    if (err) return resultForParseError(err, prov);
    return verifyReceipt(value, indexes[c.trust_policy], prov);
  }
  return verifyReceipt(c.receipt, indexes[c.trust_policy], prov);
}
const byId = (id) => suite.cases.find((c) => c.id === id);

test(`all ${suite.cases.length} vectors deep-equal expected_result`, () => {
  assert.ok(suite.cases.length >= 100);
  for (const c of suite.cases) {
    assert.deepStrictEqual(run(c), c.expected_result, `vector ${c.id}`);
  }
});

test('hand-written expectations hold', () => {
  for (const c of suite.cases) {
    const r = run(c); const e = c.expect;
    assert.equal(r.receipt_valid, e.receipt_valid, c.id);
    assert.equal(r.rejection ? r.rejection.code : null, e.rejection_code, c.id);
    if (e.receipt_valid) {
      assert.deepStrictEqual(r.issuer_verdict, e.issuer_verdict, c.id);
      assert.deepStrictEqual(r.signed_properties, e.signed_properties, c.id);
      assert.deepStrictEqual(r.unsigned_fields_present, e.unsigned_fields_present, c.id);
      assert.equal(r.issuer.key_currency, e.key_currency, c.id);
    } else {
      assert.equal(r.issuer_verdict, null); assert.equal(r.signed_properties, null); assert.equal(r.boundary, null);
    }
  }
});

test('bundled snapshot is byte-identical to the suite copy and matches provenance', () => {
  const raw = readFileSync(join(root, 'keys', 'v02', 'sar-keys-v02-snapshot.json'));
  const prov = JSON.parse(readFileSync(join(root, 'keys', 'v02', 'sar-keys-v02-snapshot.provenance.json'), 'utf8'));
  assert.equal(createHash('sha256').update(raw).digest('hex'), prov.sha256);
  assert.ok(raw.equals(readFileSync(join(fx, 'sar-keys-snapshot.json'))));
  assert.equal(prov.sha256, suite.trust_policies.production.provenance.sha256);
});

test('broken registries are trust policy errors', () => {
  for (const bad of [null, {}, { keys: [{ kid: 'a' }, { kid: 'a' }] }, { keys: [{}] }]) {
    assert.throws(() => buildTrustIndex(bad), TrustPolicyError);
  }
});

test('tool definition is additive and named verify_receipt_v02', () => {
  assert.equal(TOOL_DEFINITION.name, 'verify_receipt_v02');
  assert.deepStrictEqual(TOOL_DEFINITION.inputSchema.required, ['receipt']);
  assert.equal(TOOL_DEFINITION.inputSchema.additionalProperties, false);
});

// ---- Edge-case hardening (re-review M1-M5): hand-written expectations, independent of expected_result ----

test('M1: digests are sha256: + 64 lowercase hex, whole string (astral/uppercase/non-hex/length edges)', () => {
  for (const id of ['digest-evidence-nonhex-z', 'digest-evidence-nonhex-one-g', 'digest-evidence-uppercase',
    'digest-evidence-63-hex', 'digest-evidence-65-hex', 'digest-evidence-astral-63hex', 'digest-evidence-astral-62hex',
    'digest-evidence-trailing-newline', 'digest-condition-nonhex-z', 'digest-condition-astral-63hex']) {
    const r = run(byId(id));
    assert.equal(r.receipt_valid, false, id);
    assert.equal(r.rejection.code, 'VERIFICATION_BASIS_INVALID', id);
  }
  assert.equal(run(byId('digest-valid-lowercase-hex-all-nibbles')).receipt_valid, true);
  assert.deepStrictEqual(run(byId('digest-multiple-bad-fields-sorted')).rejection.fields, ['condition_digest', 'evidence_digest', 'policy_ref']);
  for (const id of ['rid-astral-63hex', 'rid-astral-62hex', 'rid-nonhex-z']) assert.equal(run(byId(id)).rejection.code, 'RECEIPT_ID_MALFORMED', id);
});

test('M2: nesting beyond the cap is a normal rejection, in text and in the signed core', () => {
  for (const text of ['['.repeat(1_000_000), '['.repeat(1_000_000) + ']'.repeat(1_000_000), '{"a":'.repeat(200_000) + '1' + '}'.repeat(200_000)]) {
    const [v, err] = parseReceiptText(text);
    assert.equal(v, null); assert.equal(err[0], 'MALFORMED_JSON');
  }
  assert.equal(parseReceiptText('['.repeat(MAX_JSON_DEPTH) + ']'.repeat(MAX_JSON_DEPTH))[1], null);
  assert.equal(parseReceiptText('['.repeat(MAX_JSON_DEPTH + 1) + ']'.repeat(MAX_JSON_DEPTH + 1))[1][0], 'MALFORMED_JSON');
  assert.equal(parseReceiptText('["' + '['.repeat(500) + '\\"' + '{'.repeat(500) + '"]')[1], null);
  let deep = 'leaf';
  for (let k = 0; k < 200_000; k++) deep = [deep];
  assert.throws(() => canonicalize(deep), /nesting|depth|limit/);
  const rcpt = { ...byId('valid-pass').receipt };
  rcpt.verification_basis = { ...rcpt.verification_basis, x: deep };
  const res = verifyReceipt(rcpt, indexes.test, suite.trust_policies.test.provenance);
  assert.equal(res.rejection.code, 'CANONICALIZATION_FAILED');
});

test('M3: results containing lone surrogates serialize to valid JSON', () => {
  for (const id of ['output-lone-surrogate-echoed-version-raw', 'output-lone-surrogate-echoed-profile-raw',
    'output-lone-surrogate-echoed-kid-raw', 'output-lone-surrogate-echoed-receipt-id-raw']) {
    const text = JSON.stringify(run(byId(id)));
    assert.ok(!/[\ud800-\udfff]/.test(text), id); // JSON.stringify escapes lone surrogates
    assert.deepStrictEqual(JSON.parse(text).rejection.code, byId(id).expect.rejection_code, id);
  }
});

test('M4: out-of-range integers: unsigned inert, signed core rejected, bounded time', () => {
  for (const id of ['number-unsigned-huge-5000-digits-raw', 'number-unsigned-huge-negative-5000-digits-raw',
    'number-unsigned-exp-overflow-raw', 'number-unsigned-2^53-raw']) assert.equal(run(byId(id)).receipt_valid, true, id);
  for (const id of ['number-signed-huge-5000-digits-raw', 'number-signed-19-digits-raw', 'number-signed-exp-overflow-raw']) {
    assert.equal(run(byId(id)).rejection.code, 'CANONICALIZATION_FAILED', id);
  }
  const t0 = Date.now();
  const [v, err] = parseReceiptText('{"n":' + '9'.repeat(1_000_000) + '}');
  assert.equal(err, null); assert.equal(v.n, Infinity);
  const many = '[' + Array.from({ length: 50_000 }, (_, k) => k).join(',') + ']';
  assert.equal(parseReceiptText(many)[0].length, 50_000);
  assert.ok(Date.now() - t0 < 5000, 'number parsing must be linear');
});

test('M5: signed __proto__ (and constructor/prototype) survive output, in the right bucket, with no prototype effect', () => {
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  for (const [id, bucket, mapped] of [['proto-signed-property-pass', 'established', 'established'],
    ['proto-signed-property-fail', 'contradicted', 'contradicted'], ['proto-signed-property-unknown', 'not_established', 'not_established'],
    ['proto-signed-property-pass-raw', 'established', 'established']]) {
    const r = run(byId(id));
    assert.equal(r.receipt_valid, true, id);
    assert.ok(has(r.signed_properties, '__proto__'), id + ' signed_properties');
    assert.ok(has(r.boundary.properties, '__proto__'), id + ' boundary.properties');
    assert.equal(r.boundary.properties.__proto__, mapped, id);
    assert.ok(r.boundary[bucket].includes('__proto__'), id + ' bucket');
    assert.equal(Object.getPrototypeOf(r.signed_properties), Object.prototype);
    assert.ok(JSON.stringify(r.signed_properties).includes('"__proto__"'), id);
  }
  const b = run(byId('proto-builtin-object-names-as-properties'));
  for (const k of ['constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf', '__defineGetter__', '__lookupGetter__']) {
    assert.ok(has(b.signed_properties, k) && has(b.boundary.properties, k), k);
  }
  assert.ok(b.boundary.established.includes('constructor') && b.boundary.not_established.includes('prototype') && b.boundary.contradicted.includes('toString'));
  const u = run(byId('proto-unsigned-top-level-raw'));
  assert.deepStrictEqual(u.unsigned_fields_present, ['__proto__']);
  run(byId('proto-signed-basis-extra-object'));
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.keys(Object.prototype).length, 0);
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
  assert.equal(({}).pass, undefined);
});

test('vector suite covers every hardening category', () => {
  const cats = new Set(suite.cases.map((c) => c.category));
  for (const c of ['digest', 'depth', 'output', 'number', 'proto']) assert.ok(cats.has(c), c);
});

await atest('tool: real -06 receipt verifies offline with the bundled snapshot', async () => {
  const real = byId('valid-real-06-indeterminate');
  const res = await handleVerifyReceiptV02({ receipt: real.receipt });
  assert.equal(res.receipt_valid, true);
  assert.equal(res.issuer_verdict.verdict, 'INDETERMINATE');
  assert.equal(res.issuer.trust_snapshot.sha256, suite.trust_policies.production.provenance.sha256);
  assert.deepStrictEqual(res, real.expected_result);
  // string input takes the same path
  assert.deepStrictEqual(await handleVerifyReceiptV02({ receipt: JSON.stringify(real.receipt) }), real.expected_result);
});

await atest('tool: pinned snapshot rejects test-key receipts as UNKNOWN_KEY', async () => {
  const res = await handleVerifyReceiptV02({ receipt: byId('valid-pass').receipt });
  assert.equal(res.receipt_valid, false);
  assert.equal(res.rejection.code, 'UNKNOWN_KEY');
});

await atest('tool: strict string parsing', async () => {
  assert.equal((await handleVerifyReceiptV02({ receipt: '{nope' })).rejection.code, 'MALFORMED_JSON');
  assert.equal((await handleVerifyReceiptV02({ receipt: byId('canon-duplicate-key-raw').receipt_raw })).rejection.code, 'DUPLICATE_KEY');
  await assert.rejects(() => handleVerifyReceiptV02({}), /receipt is required/);
});

await atest('verification opens no network connection', async () => {
  const orig = net.Socket.prototype.connect;
  net.Socket.prototype.connect = () => { throw new Error('network access attempted'); };
  try {
    for (const c of suite.cases) run(c);
    await handleVerifyReceiptV02({ receipt: byId('valid-real-06-indeterminate').receipt });
  } finally { net.Socket.prototype.connect = orig; }
});

test('lib source has no network or filesystem imports', () => {
  const src = readFileSync(join(root, 'src', 'lib', 'verifyV02.js'), 'utf8');
  for (const banned of ['node:http', 'node:https', 'node:net', 'node:fs', 'fetch(', 'process.env']) {
    assert.ok(!src.includes(banned), banned);
  }
});

console.log(`verify_receipt_v02 self-test: ${passed} groups passed${process.exitCode ? ' (with FAILURES)' : ''}`);
