# CrewAI / SHACKLE / SAR Composition Artifact

> Mirrored from Default Settlement internal evidence commit `5fad44a`
> (`docs: add CrewAI SHACKLE SAR composition artifact`). Morpheus remains
> the internal evidence source of truth; this public copy is provided as
> a runnable composition example.

## Purpose

This is a small, local, runnable example of what an **implementation
conformance result row** looks like when its `evidence_refs` slot resolves
to a **Settlement Attestation Receipt (SAR)** — one concrete instance of
the layer-neutral `evidence_refs` shape discussed in the CrewAI thread
(crewAIInc/crewAI#6025), following up on hummbl-dev's hook adapter mapping
and Fame510's published SHACKLE fixtures.

It exists to answer one question with a runnable artifact instead of a
claim: *"what does it look like when a conformance result's evidence_refs
points at a real, independently verifiable receipt?"*

## Artifact boundaries

This artifact:
- reads one existing public SHACKLE fixture case (`allow_within_thresholds`,
  commit `c34c213078815552002b0395175965b60426a3ff`) and reproduces it in
  minimal, attributed form (`fixture-snapshot.json`)
- constructs one example implementation result row
  (`result-row.example.json`) for that case
- points that row's `evidence_refs` at one existing, already-public SAR
  demonstration receipt (`defaultverifier.com/demo/sar-402`,
  `sha256:91e2ae85f03c7a8e7df10e8862895b99456cb13abc50b4e23ba84f1c15b3b8c9`)
- defines a small, evidence-format-neutral JSON Schema for what can occupy
  an `evidence_refs` entry (`evidence-ref.schema.json`)
- provides a stdlib-only local script (`verify_composition.py`) that
  structurally validates the result row

This artifact does **not**:
- touch, fork, patch, or re-run SHACKLE's `decide()` code
- touch CrewAI, its repo, or its issue thread
- deploy anything, call any network service, or touch any production
  Default Settlement system
- generate, use, or reference any private key
- alter any existing production SAR receipt

## How this preserves fixture / result / evidence layering

Three layers stay visibly distinct in this artifact, matching Default
Settlement doctrine and the two-layer distinction defended in the CrewAI
thread:

1. **Object/control layer** (`observed_decision` / `expected_decision`):
   ALLOW / DENY / HITL — SHACKLE's own typed decision vocabulary, taken
   unmodified from the published fixture.
2. **Conformance/result layer** (`result`): PASS / FAIL / NON_CONFORMANT /
   UNTESTABLE — a separate field describing whether the *implementation*
   matched the *fixture's expectation*. This artifact's example uses PASS
   because `allow_within_thresholds` is a straightforward matching case.
   (Note: the inspected SHACKLE repo itself does not yet have a distinct
   UNTESTABLE value at this layer — see the inspection report referenced
   below. This artifact's schema supports UNTESTABLE as a value regardless,
   since that is the layer where it belongs.)
3. **Evidence layer** (`evidence_refs`): a pointer to independently
   verifiable evidence that the conformance check happened — here, a SAR.
   This layer is intentionally **format-neutral**: `evidence-ref.schema.json`
   allows `type: "sar"` as one recognized value among others (e.g.
   `ledger_entry`, `signed_log`, `custom`). Nothing in the schema requires
   SAR, and nothing implies SHACKLE, CrewAI, or hummbl-dev's tooling must
   use SAR to fill this slot.

**The result row reports conformance; the receipt carries delivery-boundary
evidence; SHACKLE's zero-I/O `decide()` surface stays untouched.**

## How to run the local check

```
cd artifacts/crewai-shackle-sar-composition-20260704
python3 verify_composition.py
# or: make verify
```

No network access is required or attempted. No dependencies beyond the
Python 3 standard library.

## Explicit non-claims

- **Not a SHACKLE contribution.** No SHACKLE file was modified; the fixture
  excerpt here is a minimal, attributed local copy for illustration only.
- **Not a CrewAI contribution.** No CrewAI file, issue, or PR was touched.
- **Not hummbl-dev adoption of anything.** This artifact does not claim
  hummbl-dev's hook adapter uses, endorses, or depends on SAR.
- **Not SHACKLE adoption of SAR.** SHACKLE does not depend on SAR, does not
  emit SAR receipts, and this artifact does not claim otherwise. SAR is
  presented as *one* evidence format that fits the `evidence_refs` slot in
  this artifact's example — not the only one, and not one SHACKLE has
  adopted.
- **Not a standard.** `evidence-ref.schema.json` is a small local draft
  schema for this composition example, not a proposed or ratified standard.
- **Not proof of payment or legal finality.** The referenced SAR is a
  *demonstration* receipt (`defaultverifier.com/demo/sar-402`, marked
  `demonstration: true` in the result row). It attests only that a
  conformance check was recorded at a delivery boundary — nothing about
  payment settlement or legal finality.
- **Not a change to SHACKLE's `decide()`.** `decide()` was read, not
  modified. Its zero-I/O control surface is untouched.

## Source references

- SHACKLE repo: https://github.com/Fame510/SHACKLE
- SHACKLE commit inspected/used: `c34c213078815552002b0395175965b60426a3ff`
- Fixture excerpted: `fixtures/conformance.json`, case `allow_within_thresholds`
  (see `fixture-snapshot.json` for the minimal attributed copy)
- Prior inspection report:
  `reports/external-actions/crewai-shackle-fixture-inspection-20260704.md`
- Prior CrewAI comment preservation:
  `reports/external-actions/crewai-shackle-fixture-comment-20260704.md`
- SAR demo receipt: `https://defaultverifier.com/demo/sar-402`
  (`sha256:91e2ae85f03c7a8e7df10e8862895b99456cb13abc50b4e23ba84f1c15b3b8c9`)
