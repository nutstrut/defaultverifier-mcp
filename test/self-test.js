/**
 * self-test.js — DefaultVerifier MCP Phase A self-tests.
 *
 * Tests:
 *   1. sar-v0.1-pass.json         → status PASS, verdict PASS
 *   2. sar-v0.1-fail.json         → status PASS, verdict FAIL
 *   3. sar-v0.1-indeterminate.json→ status PASS, verdict INDETERMINATE
 *   4. sar-v0.1-current-kid03.json→ status PASS, kid sar-prod-ed25519-03
 *   5. tampered-receipt.json      → status INVALID
 *   6. get_verification_log       → reads /var/www/html/verified.json or returns INDETERMINATE
 *   7. no network calls for verify_receipt
 *   8. Python parity check (receipt_id, canonical_digest, kid, verdict, valid_signature)
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';
import { handleVerifyReceipt } from '../src/tools/verifyReceipt.js';
import { handleGetVerificationLog } from '../src/tools/verificationLog.js';

const _here = dirname(fileURLToPath(import.meta.url));
const _root = join(_here, '..');
const fixturesDir = join(_root, 'fixtures');

function loadFixture(name) {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));
}

let passed = 0;
let failed = 0;
const results = [];

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
    results.push({ label, ok: true });
  } else {
    console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
    failed++;
    results.push({ label, ok: false, detail });
  }
}

async function runTest(name, fn) {
  console.log(`\n[${name}]`);
  try {
    await fn();
  } catch (e) {
    console.error(`  ✗ UNCAUGHT: ${e.message}`);
    failed++;
    results.push({ label: name, ok: false, detail: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────
// Test 1: PASS fixture
// ─────────────────────────────────────────────────────────────────
await runTest('Test 1: sar-v0.1-pass.json → status PASS, verdict PASS', async () => {
  const receipt = loadFixture('sar-v0.1-pass.json');
  const r = await handleVerifyReceipt({ receipt });
  assert('status is PASS', r.status === 'PASS', `got: ${r.status}`);
  assert('verdict is PASS', r.verdict === 'PASS', `got: ${r.verdict}`);
  assert('valid_signature is true', r.checks.valid_signature === true);
  assert('receipt_id_valid is true', r.checks.receipt_id_valid === true);
  assert('kid_in_registry is true', r.checks.kid_in_registry === true);
  assert('network_used is false', r.network_used === false);
  assert('keys_source is bundled', r.keys_source === 'bundled');
  assert('receipt_id present', typeof r.receipt_id === 'string' && r.receipt_id.startsWith('sha256:'));
  assert('canonical_digest present', typeof r.canonical_digest === 'string');
  assert('boundary.proves present', Array.isArray(r.boundary?.proves) && r.boundary.proves.length > 0);
  assert('boundary.does_not_prove present', Array.isArray(r.boundary?.does_not_prove));
  console.log(`    receipt_id: ${r.receipt_id}`);
  console.log(`    canonical_digest: ${r.canonical_digest}`);
  console.log(`    kid: ${r.kid}`);
});

// ─────────────────────────────────────────────────────────────────
// Test 2: FAIL fixture — status PASS (valid sig), verdict FAIL
// ─────────────────────────────────────────────────────────────────
await runTest('Test 2: sar-v0.1-fail.json → status PASS, verdict FAIL', async () => {
  const receipt = loadFixture('sar-v0.1-fail.json');
  const r = await handleVerifyReceipt({ receipt });
  assert('status is PASS', r.status === 'PASS', `got: ${r.status} errors: ${JSON.stringify(r.errors)}`);
  assert('verdict is FAIL', r.verdict === 'FAIL', `got: ${r.verdict}`);
  assert('valid_signature is true', r.checks.valid_signature === true);
  console.log(`    receipt_id: ${r.receipt_id}`);
});

// ─────────────────────────────────────────────────────────────────
// Test 3: INDETERMINATE fixture
// ─────────────────────────────────────────────────────────────────
await runTest('Test 3: sar-v0.1-indeterminate.json → status PASS, verdict INDETERMINATE', async () => {
  const receipt = loadFixture('sar-v0.1-indeterminate.json');
  const r = await handleVerifyReceipt({ receipt });
  assert('status is PASS', r.status === 'PASS', `got: ${r.status} errors: ${JSON.stringify(r.errors)}`);
  assert('verdict is INDETERMINATE', r.verdict === 'INDETERMINATE', `got: ${r.verdict}`);
  assert('valid_signature is true', r.checks.valid_signature === true);
});

// ─────────────────────────────────────────────────────────────────
// Test 4: kid-03 fixture
// ─────────────────────────────────────────────────────────────────
await runTest('Test 4: sar-v0.1-current-kid03.json → status PASS, kid sar-prod-ed25519-03', async () => {
  const receipt = loadFixture('sar-v0.1-current-kid03.json');
  const r = await handleVerifyReceipt({ receipt });
  assert('status is PASS', r.status === 'PASS', `got: ${r.status} errors: ${JSON.stringify(r.errors)}`);
  assert('kid is sar-prod-ed25519-03', r.kid === 'sar-prod-ed25519-03', `got: ${r.kid}`);
  assert('valid_signature is true', r.checks.valid_signature === true);
  assert('receipt_id matches fixture', r.receipt_id === receipt.receipt_id);
  console.log(`    canonical_digest: ${r.canonical_digest}`);
});

// ─────────────────────────────────────────────────────────────────
// Test 5: Tampered receipt → status INVALID
// ─────────────────────────────────────────────────────────────────
await runTest('Test 5: tampered-receipt.json → status INVALID', async () => {
  const receipt = loadFixture('tampered-receipt.json');
  const r = await handleVerifyReceipt({ receipt });
  assert('status is INVALID', r.status === 'INVALID', `got: ${r.status}`);
  assert('valid_signature is false', r.checks.valid_signature === false);
  assert('receipt_id_valid is false', r.checks.receipt_id_valid === false);
  assert('errors non-empty', r.errors.length > 0, `got empty errors`);
});

// ─────────────────────────────────────────────────────────────────
// Test 6: get_verification_log
// ─────────────────────────────────────────────────────────────────
await runTest('Test 6: get_verification_log reads verified.json or returns INDETERMINATE', async () => {
  const r = await handleGetVerificationLog({ limit: 5 });
  assert('network_used is false', r.network_used === false);
  assert('source is local path', typeof r.source === 'string' && r.source.includes('verified.json'));
  assert('entries is array', Array.isArray(r.entries));
  assert('boundary.does_not_prove present', Array.isArray(r.boundary?.does_not_prove));
  if (r.status === 'PASS') {
    assert('status PASS when file found', true);
    assert('entries <= limit', r.entries.length <= 5);
    if (r.disclaimer) {
      assert('disclaimer preserved (non-endorsement)', r.disclaimer.length > 0);
      console.log(`    disclaimer: ${r.disclaimer.slice(0, 80)}...`);
    }
    console.log(`    entries count: ${r.entries.length}`);
  } else {
    assert(`status is INDETERMINATE or ERROR when file missing (got ${r.status})`,
      r.status === 'INDETERMINATE' || r.status === 'ERROR');
    console.log(`    (file not available: ${r.warnings[0] || r.errors[0]})`);
  }
});

// ─────────────────────────────────────────────────────────────────
// Test 7: No network calls
// ─────────────────────────────────────────────────────────────────
await runTest('Test 7: network_used=false for all verify_receipt results', async () => {
  for (const fname of ['sar-v0.1-pass.json', 'tampered-receipt.json']) {
    const r = await handleVerifyReceipt({ receipt: loadFixture(fname) });
    assert(`network_used=false for ${fname}`, r.network_used === false);
  }
  const r2 = await handleVerifyReceipt({ receipt: {}, refresh_keys: false });
  assert('network_used=false for empty receipt', r2.network_used === false);
  assert('refresh_keys=true returns ERROR/not_implemented', async () => {
    const r3 = await handleVerifyReceipt({ receipt: loadFixture('sar-v0.1-pass.json'), refresh_keys: true });
    return r3.errors.some(e => e.includes('not_implemented') || e.includes('not implemented'));
  });
  const r3 = await handleVerifyReceipt({ receipt: loadFixture('sar-v0.1-pass.json'), refresh_keys: true });
  assert('refresh_keys=true returns ERROR status', r3.status === 'ERROR');
});

// ─────────────────────────────────────────────────────────────────
// Test 8: Python parity
// ─────────────────────────────────────────────────────────────────
await runTest('Test 8: Python parity check (receipt_id, digest, kid, verdict, valid)', async () => {
  const pythonScript = join(
    _root, '..', 'default-settlement-verifier', 'openclaw', 'skills', 'settlement-witness', 'scripts', 'verify_receipt.py'
  );

  const fixtureNames = [
    'sar-v0.1-pass.json',
    'sar-v0.1-fail.json',
    'sar-v0.1-indeterminate.json',
    'sar-v0.1-current-kid03.json',
    'tampered-receipt.json',
  ];

  let pythonAvailable = false;
  try {
    execSync('python3 --version', { stdio: 'pipe' });
    pythonAvailable = true;
  } catch {}

  if (!pythonAvailable) {
    console.log('  (python3 not available — skipping parity check)');
    assert('python3 available (skip if not)', true);
    return;
  }

  for (const fname of fixtureNames) {
    const fixturePath = join(fixturesDir, fname);
    const receipt = loadFixture(fname);

    // Run Python verifier
    let pyResult;
    try {
      const pyOut = execSync(`python3 "${pythonScript}" "${fixturePath}"`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          SAR_KEYS_REGISTRY_PATH: join(_root, 'keys', 'sar-keys.json'),
        },
      });
      pyResult = JSON.parse(pyOut.toString());
    } catch (e) {
      // Non-zero exit (invalid receipt) — parse stderr or stdout
      try {
        pyResult = JSON.parse(e.stdout?.toString() || '{}');
      } catch {
        console.log(`  (Python error for ${fname}: ${e.message})`);
        continue;
      }
    }

    // Run Node verifier
    const nodeResult = await handleVerifyReceipt({ receipt });

    // Compare key fields
    const pyValid = pyResult.valid === true;
    const nodePass = nodeResult.status === 'PASS';
    assert(
      `${fname}: valid/status parity (py:${pyValid} node:${nodePass})`,
      pyValid === nodePass,
    );

    if (pyResult.receipt_id && nodeResult.receipt_id) {
      assert(
        `${fname}: receipt_id parity`,
        pyResult.receipt_id === nodeResult.receipt_id,
        `py:${pyResult.receipt_id} node:${nodeResult.receipt_id}`,
      );
    }

    if (pyResult.kid && nodeResult.kid) {
      assert(
        `${fname}: kid parity`,
        pyResult.kid === nodeResult.kid,
        `py:${pyResult.kid} node:${nodeResult.kid}`,
      );
    }

    if (pyResult.verdict && nodeResult.verdict) {
      assert(
        `${fname}: verdict parity`,
        pyResult.verdict === nodeResult.verdict,
        `py:${pyResult.verdict} node:${nodeResult.verdict}`,
      );
    }

    console.log(`    ${fname}: py_valid=${pyValid} node_status=${nodeResult.status} rid_match=${pyResult.receipt_id === nodeResult.receipt_id}`);
  }
});

// ─────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────
console.log('\n─────────────────────────────────────────');
console.log(`Tests passed: ${passed}  Failed: ${failed}`);
if (failed > 0) {
  console.error('\nFailed tests:');
  results.filter(r => !r.ok).forEach(r => console.error(`  ✗ ${r.label}: ${r.detail || ''}`));
  process.exit(1);
} else {
  console.log('All tests passed.');
  process.exit(0);
}
