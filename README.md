# DefaultVerifier MCP — Phase A

Agent-native MCP server for DefaultVerifier. Phase A starts with verification, not emission.

## What this is

An MCP server that exposes DefaultVerifier's verification surface to AI agents. It verifies signed settlement receipts locally — offline, no network required. This is a **verifier** MCP: it never issues, signs or emits receipts and never contacts SettlementWitness. Issuance/emission is a different service (the hosted SettlementWitness MCP, port 3003, not part of this repo). Verification ≠ issuance; offline verification ≠ hosted evaluation.

This server is a local dev server and is not deployed to production by this repo.

**Doctrine:**
```
Capability ≠ Authority
Authority ≠ Execution
Execution ≠ Verification
Verification must leave evidence
```

## Phase A tools

| Tool | Scope | Trust root | Network |
|------|-------|-----------|---------|
| `verify_receipt` | Default Settlement v0.1 (wallet-bound) | bundled v0.1 registry (`keys/sar-keys.json`) | none |
| `verify_portable_sar_receipt` | Portable SAR v0.1 (six-field profile) | caller-supplied `key_policy` (no default) | none |
| `verify_receipt_v02` | Default Settlement `0.2-candidate` | pinned registry snapshot (`keys/v02/`) | none |
| `get_verification_log` | local log read (not a verifier) | n/a | none |

The three verifiers are separate and never upgrade or reinterpret each other's receipts. None can issue a receipt.

### `verify_receipt`

Verify a signed SAR v0.1 receipt locally.

- Offline — no network calls
- Canonicalizes using RFC 8785 / JCS
- Verifies Ed25519 signature against bundled public key registry
- Returns typed result with `status` (tool outcome) and `verdict` (issuer's signed outcome)

**Key semantics:**
- `status=PASS` means the signature and digest are cryptographically valid
- `verdict` is the issuer-signed outcome from the receipt itself (PASS/FAIL/INDETERMINATE)
- A valid FAIL receipt returns `{ status:"PASS", verdict:"FAIL" }`
- A tampered receipt returns `{ status:"INVALID" }`

### `verify_portable_sar_receipt`

Verify a **Portable SAR v0.1** (six-field, original/portable profile) receipt. Separate from `verify_receipt`
(neither handler calls the other).

- Offline, no network; no receipt issuance.
- No bundled trust store: the caller **must** supply `key_policy` (`kid -> {pubkey_b64url, profiles, source}`).
- `counterparty` / `_ext`, if present, are reported as unsigned metadata and never as an attested wallet binding.

### `verify_receipt_v02`

Verify a Default Settlement **v0.2-candidate** receipt (`receipt_version: "0.2-candidate"`, profiles
`settlement-witness-verified-v0.2` and `settlement-witness-verified-v0.2-counterparty-bound`) locally.
Additive: `verify_receipt` (v0.1) is unchanged, and v0.1 / portable receipts sent here are rejected as
`NOT_A_V02_RECEIPT`, never upgraded.

- Offline only, no network fetch, no receipt issuance, never contacts SettlementWitness. `0.2-candidate` is
  supported literally; it is not renamed to a finalized `0.2`. Not deployed by this change.
- Signed `properties` feed the deterministic boundary; a valid `FAIL` or `INDETERMINATE` receipt is still a valid receipt.
- Trust root is the bundled, pinned **full registry** snapshot
  `keys/v02/sar-keys-v02-snapshot.json` (not JWKS: only the registry carries key status, use and
  authorized profiles). Provenance and sha256 are in the result (`issuer.trust_snapshot`) and in
  `keys/v02/sar-keys-v02-snapshot.provenance.json`. No caller key override, no refresh.
- `receipt_valid` is receipt validity. `issuer_verdict` is the issuer's signed verdict. They are independent:
  a valid FAIL or INDETERMINATE receipt has `receipt_valid: true`. There is no overloaded `status: PASS`.
- `signed_properties` / `boundary` map `pass`/`fail`/`unknown` to `established`/`contradicted`/`not_established`.
  `unknown` is never false. `boundary.not_implied` lists what the receipt does not imply
  (runtime execution, payment finality and legal finality unless signed `pass`; always current admissibility,
  external effect, general agent safety, endorsement, certification).
- `unsigned_fields_present` lists top-level fields outside the signed core (e.g. `_unsigned`, `payment`);
  they never affect validity.
- `established` means *established as an authentic issuer-signed property of the receipt*, not independently
  verified external truth. Digests must be `sha256:` + 64 lowercase hex. Input nested deeper than 64 containers is
  `MALFORMED_JSON`; out-of-range numbers are rejected in the signed core and inert in unsigned fields; a signed
  property named `__proto__` is preserved like any other.
- Unknown `verifier_kid` fails closed (`UNKNOWN_KEY`); reserved / withdrawn keys (e.g. `-04`) are `KEY_NOT_ACTIVE`;
  a key not authorized for the receipt's profile is `PROFILE_NOT_AUTHORIZED`; a retired key verifies
  historically with `issuer.key_currency: "historical"`.

Contract: `specs/default-settlement-v02-verification/v0.2-candidate/SPEC.md` in the Morpheus repository.
The shared vectors (`fixtures/v02/vectors.json`, byte copy of the normative suite) are the cross-language
contract: `npm run test:v02` requires a result deep-equal to the reference (Python) implementation's for every case.

### `get_verification_log`

Return entries from DefaultVerifier's local verification log (`/var/www/html/verified.json`).

- Local file only in Phase A
- Preserves the file's disclaimer and non-endorsement language
- Does not add endorsement language

## Boundaries (what DefaultVerifier does NOT claim)

- Does not prove payment finality
- Does not prove legal settlement finality
- Does not execute tasks
- Does not approve actions
- Does not release or custody funds
- Does not imply partnership, endorsement, or official integration
- Does not issue TrustScores

## How to run

```bash
npm install
npm test       # run self-tests (requires all tests to pass before commit)
npm start      # starts on 127.0.0.1:3013 (dev only — do not deploy directly)
```

Health check: `curl http://127.0.0.1:3013/healthz`

MCP endpoint: `http://127.0.0.1:3013/mcp`

## Local-first design

`verify_receipt`, `verify_portable_sar_receipt` and `verify_receipt_v02` require no network. `verify_receipt` uses:
- `keys/sar-keys.json` — bundled public key registry (kid-01, kid-02, kid-03)
- Node.js built-in `crypto` for Ed25519 verification
- `canonicalize` npm package (RFC 8785/JCS) for byte-for-byte parity with the Python verifier

## Key registry

`keys/sar-keys.json` (used by `verify_receipt`, v0.1) bundles three historical production keys:
- `sar-prod-ed25519-01` — original key
- `sar-prod-ed25519-02` — documented non-operational duplicate of `-03`'s public key
- `sar-prod-ed25519-03` — **retired** historical signer (superseded by `-05`; historical verification only)

This is a v0.1 historical set, not the current signer list. The current production registry also lists
`sar-prod-ed25519-05` (active for v0.1) and `sar-prod-ed25519-06` (active, the only key authorized for v0.2
profiles); `-04` was withdrawn before activation. `verify_receipt_v02` uses the full pinned registry snapshot in
`keys/v02/` and never fetches keys.

## Fixtures

| File | Expected result |
|------|----------------|
| `sar-v0.1-pass.json` | status PASS, verdict PASS |
| `sar-v0.1-fail.json` | status PASS, verdict FAIL |
| `sar-v0.1-indeterminate.json` | status PASS, verdict INDETERMINATE |
| `sar-v0.1-current-kid03.json` | status PASS, kid sar-prod-ed25519-03 |
| `tampered-receipt.json` | status INVALID |

## Future phases

- Phase B: `resolve_receipt` — resolve a receipt_id to its canonical source
- Phase C: `resolve_chain` — follow a receipt chain
- Phase D: `check_issuer` — issuer registry lookup
- Phase E: `emit_receipt_optional` — optional emission surface
- Phase F: TrustProfile

## Port assignment

Dev port: `127.0.0.1:3013` (not proxied — do not expose without nginx config review)

Production `settlement-witness-mcp` remains on port 3003 and is not modified by this repo.
