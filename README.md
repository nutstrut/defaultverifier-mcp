# DefaultVerifier MCP — Phase A

Agent-native MCP server for DefaultVerifier. Phase A starts with verification, not emission.

## What this is

An MCP server that exposes DefaultVerifier's verification surface to AI agents. It verifies signed SAR v0.1 settlement receipts locally — offline, no network required.

**Doctrine:**
```
Capability ≠ Authority
Authority ≠ Execution
Execution ≠ Verification
Verification must leave evidence
```

## Phase A tools

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

`verify_receipt` requires no network. It uses:
- `keys/sar-keys.json` — bundled public key registry (kid-01, kid-02, kid-03)
- Node.js built-in `crypto` for Ed25519 verification
- `canonicalize` npm package (RFC 8785/JCS) for byte-for-byte parity with the Python verifier

## Key registry

Includes three production keys:
- `sar-prod-ed25519-01` — original key
- `sar-prod-ed25519-02` — rotation 2
- `sar-prod-ed25519-03` — current key (used by recent receipts)

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
