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
  buildTrustIndex, parseReceiptText, resultForParseError, verifyReceipt, TrustPolicyError,
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
