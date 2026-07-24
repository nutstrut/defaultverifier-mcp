/**
 * self-test-portable.js — Portable SAR v0.1 MCP tool self-tests.
 *
 * Separate from self-test.js; does not import or exercise
 * handleVerifyReceipt (the wallet-bound tool). Runs the shared synthetic
 * fixture corpus bundled at fixtures/portable/.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { handleVerifyPortableSarReceipt } from '../src/tools/verifyPortableReceipt.js';

const _here = dirname(fileURLToPath(import.meta.url));
const _root = join(_here, '..');
const fixturesDir = join(_root, 'fixtures', 'portable');

const fixtures = JSON.parse(readFileSync(join(fixturesDir, 'portable-sar-fixtures.json'), 'utf8'));
const keyRegistryRaw = JSON.parse(readFileSync(join(fixturesDir, 'portable-sar-fixture-keys.json'), 'utf8'));

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

const EXPECTED = {
  '01_valid_portable': 'VERIFIED',
  '02_unsigned_counterparty': 'VERIFIED',
  '03_with_ext': 'VERIFIED',
  '04_tampered_signed_field': 'REJECTED_RECEIPT_ID_MISMATCH',
  '06_unknown_key': 'REJECTED_UNKNOWN_KEY',
  '07_spoofed_key': 'REJECTED_INVALID_SIGNATURE',
  '09_malformed_version': 'REJECTED_NOT_PORTABLE_CANDIDATE',
  '11_walletbound_presented_as_portable': 'REJECTED_NOT_PORTABLE_CANDIDATE',
  '12_metadata_grafted_walletbound': 'REJECTED_PROFILE_NOT_AUTHORIZED',
  '14_ambiguous_envelope': 'VERIFIED',
};

for (const [name, expectedStatus] of Object.entries(EXPECTED)) {
  const result = await handleVerifyPortableSarReceipt({ receipt: fixtures[name], key_policy: keyRegistryRaw });
  assert(`${name} => ${expectedStatus}`, result.status === expectedStatus, `got ${result.status}: ${result.reason}`);
  assert(`${name} network_used === false`, result.network_used === false);
}

// tool schema sanity
import { TOOL_DEFINITION } from '../src/tools/verifyPortableReceipt.js';
assert('tool name is verify_portable_sar_receipt', TOOL_DEFINITION.name === 'verify_portable_sar_receipt');
assert('tool requires key_policy', TOOL_DEFINITION.inputSchema.required.includes('key_policy'));

// verified receipts never attest wallet binding
for (const [name, expectedStatus] of Object.entries(EXPECTED)) {
  if (expectedStatus !== 'VERIFIED') continue;
  const result = await handleVerifyPortableSarReceipt({ receipt: fixtures[name], key_policy: keyRegistryRaw });
  assert(`${name} walletBindingAttested === false`, result.walletBindingAttested === false);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
