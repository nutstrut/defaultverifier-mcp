# ds.evidence_ref.v0.1

> Public mirror of the draft ds.evidence_ref.v0.1 spec preserved in Morpheus commit `8f73d31`.

**Status:** Draft / internal, pending Keith approval. Not published externally. Not an adopted standard.

## 1. Definition

A `ds.evidence_ref.v0.1` object is a **format-neutral reference to a verifiable evidence object**. It lets another artifact say: *"the evidence for this claim/outcome can be checked here, under these rules and boundaries."*

It is the reference object that lets one system point at evidence produced by another system — a Settlement Attestation Receipt (SAR), a signed log entry, a conformance result, a control-layer decision record — **without adopting the issuer's architecture**. This is the second object in the Evidence Rails sequence: definition page ([defaultverifier.com/evidence-rails](https://defaultverifier.com/evidence-rails)) → `ds.evidence_ref.v0.1` (this document) → Evidence Ref Builder / Verifier skill/tool (not built yet; gated on this schema).

## 2. Non-goals

`ds.evidence_ref.v0.1` is explicitly **not**:

- a receipt format itself
- a verifier (it does not run checks; it points at what could be checked)
- a payment rail
- custody, escrow, or fund release
- proof of legal or payment finality
- authority or approval of any action
- a trust score or reputation signal
- a requirement to use SAR, DefaultVerifier, or any Default Settlement service

Evidence refs point to evidence; **they do not create authority**. Evidence rails move proof, not value. An evidence ref does not approve, execute, escrow, custody, or release funds, and does not prove legal or payment finality — those boundary claims apply to the evidence ref exactly as they apply to DefaultVerifier itself (see `state/DOCTRINE.md`).

## 3. Required fields

| Field | Type | Description |
|---|---|---|
| `schema_id` | string | Must equal `"ds.evidence_ref.v0.1"`. |
| `ref_id` | string | Stable local identifier for this evidence reference inside the parent artifact. Example: `"evidence-ref-001"`. |
| `evidence_type` | string | Format/type of the referenced evidence. Not restricted to SAR. Examples: `"sar"`, `"sar_402"`, `"conformance_result"`, `"transition_receipt"`, `"signed_log_entry"`, `"external_artifact"`. |
| `boundary` | string | Human-readable boundary statement: what this evidence reference does and does not prove. Required on every object — see §7. |
| `relation` | string | How the evidence relates to the parent artifact. Examples: `"supports_observed_outcome"`, `"delivery_boundary_evidence"`, `"decision_boundary_evidence"`, `"transition_evidence"`, `"audit_reference"`, `"conformance_evidence"`. |

At least one **locator** is required (see §5 of `schema.json`): `uri`, `digest`, or `embedded_ref`. A reference with none of these points at nothing checkable and is not a valid evidence ref.

Additional fields present in the shape but not always required:

| Field | Type | Description |
|---|---|---|
| `uri` | string | URI/URL where the evidence object can be retrieved, if available. May be omitted only if `digest` or an `embedded_ref` (inline evidence) is present. |
| `digest` | string | Content digest of the referenced evidence object, if known. Digest algorithm prefix format, e.g. `"sha256:..."`. |
| `digest_canonicalization` | string | Canonicalization rule used to compute the digest, if applicable. Example: `"jcs-rfc8785"`. |
| `issuer` | string | Optional issuer/system that produced the evidence. **Must not be treated as authority by itself** — naming an issuer is not an endorsement or a trust claim. |
| `subject` | string | Optional subject/claim/outcome this evidence supports. Keep it short and claim-bounded — it should not expand what the evidence proves. |
| `verification` | object | Verification **hints**, not verification results (see §8). Suggested subfields: `method`, `public_keys`, `verifier`, `offline_verifiable`, `verification_notes`. |
| `created_at` | string (timestamp) | When the evidence reference object was created, if known. |

## 4. Recommended fields

Useful but never required — omitting them must not break validity:

- `retrieved_at` — when the referenced evidence was last fetched/checked.
- `source_commit` — a commit hash for provenance, when the evidence lives in a git-tracked artifact.
- `profile` — a named sub-profile of `evidence_type` (e.g. `"sar-402"` under `evidence_type: "sar"`).
- `receipt_id` — meaningful only when `evidence_type` is a receipt-shaped type; absent/ignored otherwise.
- `parent_artifact_id` — identifier of the artifact this evidence ref is embedded in, for round-tripping.
- `notes` — free-text context that doesn't fit elsewhere.

## 5. Boundary requirements

Every `ds.evidence_ref.v0.1` object **must** include a non-empty `boundary` field. The boundary must state:

1. what the referenced evidence supports, and
2. what it does **not** prove.

If the referenced evidence relates to payment or settlement in any way, the boundary **must not** claim legal or payment finality unless that finality is separately and independently proven elsewhere — an evidence ref pointing at a SAR receipt, for instance, proves that a delivery/decision boundary was signed and recorded, not that funds settled or that any legal obligation was discharged.

This mirrors the boundary discipline already used in the CrewAI/SHACKLE/SAR composition artifact's `evidence-ref.schema.json` (`artifacts/crewai-shackle-sar-composition-20260704/evidence-ref.schema.json`), which required a `boundary` field for exactly this reason. `ds.evidence_ref.v0.1` generalizes that pattern into the first formal, versioned Evidence Rails object.

## 6. Verification hints vs. verification result

This distinction is load-bearing and must not collapse:

- A `ds.evidence_ref.v0.1` object tells a consumer **how to find and check** evidence — a `uri` to fetch, a `digest` to recompute against, a `verification.method` describing the check, public keys to verify a signature against.
- It does **not** itself assert PASS/FAIL. An evidence ref is a pointer with a boundary, not a verdict.
- If a consumer performs a check, the **result** of that check (PASS / FAIL / INDETERMINATE / UNTESTABLE, or a control-layer verdict like ALLOW / DENY / HITL) belongs in a **separate field on the parent artifact** — never folded into the evidence ref itself. Mixing the two would let an evidence ref quietly become a self-graded verdict, which is exactly the trust-regress problem the Evidence Rails category frame exists to avoid (see `reports/drafts/evidence-rails-definition-page-20260704.md`, "Why evidence and not trust").

## 7. Format-neutrality

SAR is **one supported evidence type**, not the required format. `evidence_type: "sar"` or `"sar_402"` are recognized values, but the schema places no special requirements on SAR beyond what applies to any other `evidence_type`. A non-SAR evidence ref (a signed log entry, an external artifact, a conformance result row from an unrelated system) is exactly as valid, provided it carries the same required fields and a real boundary statement.

This is intentional and doctrinal: DefaultVerifier does not require adoption of SAR or of Default Settlement's own services to be useful as a reference *shape*. Nothing in this schema requires an online Default Settlement service — an evidence ref can point at a locally-held file, a third party's independently hosted artifact, or a fully offline-verifiable object.

## 8. Example objects

Three worked examples are provided in `examples/`. All three validate against `schema.json` (see §10, validation output in the preservation report).

1. **`sar-delivery-boundary.example.json`** — a SAR delivery-boundary receipt reference, using the same public CrewAI / SHACKLE / SAR composition pattern already preserved in `artifacts/crewai-shackle-sar-composition-20260704/` and mirrored publicly at [compositions/crewai-shackle-sar](https://github.com/nutstrut/defaultverifier-mcp/tree/main/compositions/crewai-shackle-sar). It reuses the same known public demo digest (`sha256:91e2ae85f03c7a8e7df10e8862895b99456cb13abc50b4e23ba84f1c15b3b8c9`) and resolver path already documented in existing reports. It is explicitly labeled a demonstration reference; its boundary states plainly that it does not prove SHACKLE/CrewAI adoption, legal/payment finality, or endorsement by any named party.
2. **`external-artifact.example.json`** — a non-SAR signed-log/artifact reference, showing that the schema does not privilege SAR: no DefaultVerifier involvement, no receipt, just a signed artifact hosted elsewhere with its own digest and verification hint.
3. **`conformance-evidence.example.json`** — a conformance result evidence reference. It points at an evidence object supporting an observed outcome without merging the conformance vocabulary (PASS/FAIL/NON_CONFORMANT/UNTESTABLE) or the control vocabulary (ALLOW/DENY/HITL) into the evidence ref itself — those verdicts stay on the parent artifact, exactly as required by §6.

No new receipt IDs were invented for this draft. The only concrete digest reused is the one already publicly documented at `defaultverifier.com/demo/sar-402` and referenced in prior preserved reports.

## 9. Consumer guidance

A control layer, conformance runner, or workflow consuming a `ds.evidence_ref.v0.1` object should:

1. **Dereference** the object if a `uri` is present and network access is available/appropriate; otherwise use `digest`/`embedded_ref` for offline checks.
2. **Verify digest/signature when available** — recompute `digest` against the fetched object using `digest_canonicalization` if given, and check any signature named in `verification.method`/`verification.public_keys`.
3. **Respect the boundary.** Never let a consuming system's language claim more than the `boundary` field states. A delivery-boundary evidence ref does not become proof of payment finality just because it is convenient to say so.
4. **Do not treat the reference as authority.** The presence of an `issuer` or a resolvable `uri` is not permission to act, and is not an endorsement.
5. **Produce a separate verification result if checking was performed.** Record PASS/FAIL/INDETERMINATE (or the consumer's own vocabulary) as a field on the *parent* artifact — never inside the evidence ref (§6).

## 10. Versioning

`v0.1` is draft. Breaking changes to required fields, semantics, or the locator rule require a new `schema_id` (e.g. `ds.evidence_ref.v0.2`) — never a silent redefinition of `ds.evidence_ref.v0.1`. Substantive changes to this document, once approved, are preserved in Morpheus git history rather than rewritten in place, consistent with the DECISIONS.md append-only convention.

## References

- Evidence Rails category definition: `reports/drafts/evidence-rails-definition-page-20260704.md`, published at [defaultverifier.com/evidence-rails](https://defaultverifier.com/evidence-rails).
- Prior evidence-format-neutral precedent: `artifacts/crewai-shackle-sar-composition-20260704/evidence-ref.schema.json` and `result-row.example.json`.
- Public composition mirror: [compositions/crewai-shackle-sar](https://github.com/nutstrut/defaultverifier-mcp/tree/main/compositions/crewai-shackle-sar).
- `state/DOCTRINE.md` — boundary claims, vocabulary (SAR = Settlement Attestation Receipt; SAR-402 = x402-adjacent receipt profile, not all SAR).
