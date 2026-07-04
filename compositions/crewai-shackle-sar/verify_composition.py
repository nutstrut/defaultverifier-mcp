#!/usr/bin/env python3
"""Local, stdlib-only structural check for result-row.example.json.

Does not call the network. Does not touch SHACKLE or any production
service. Validates shape only; does not assert legal/payment finality.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROW_PATH = os.path.join(HERE, "result-row.example.json")

VALID_RESULTS = {"PASS", "FAIL", "NON_CONFORMANT", "UNTESTABLE"}
PLAUSIBLE_DECISIONS = {"ALLOW", "DENY", "HITL"}
DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")

REQUIRED_TOP_FIELDS = [
    "runtime",
    "implementation_version",
    "fixture_version",
    "case_id",
    "observed_decision",
    "expected_decision",
    "result",
    "evidence_refs",
    "terminal_outcome_ref",
]


def fail(msg):
    print(f"FAIL: {msg}")
    sys.exit(1)


def main():
    if not os.path.exists(ROW_PATH):
        fail(f"missing {ROW_PATH}")

    with open(ROW_PATH) as f:
        row = json.load(f)

    for field in REQUIRED_TOP_FIELDS:
        if field not in row:
            fail(f"missing required field '{field}'")

    if row["result"] not in VALID_RESULTS:
        fail(f"result '{row['result']}' not one of {sorted(VALID_RESULTS)}")

    if row["observed_decision"] not in PLAUSIBLE_DECISIONS:
        fail(f"observed_decision '{row['observed_decision']}' not a plausible SHACKLE object-layer decision")

    if row["expected_decision"] not in PLAUSIBLE_DECISIONS:
        fail(f"expected_decision '{row['expected_decision']}' not a plausible SHACKLE object-layer decision")

    refs = row["evidence_refs"]
    if not isinstance(refs, list):
        fail("evidence_refs must be an array")

    sar_refs = [r for r in refs if isinstance(r, dict) and r.get("type") == "sar"]
    if not sar_refs:
        fail("no evidence_refs entry has type 'sar'")

    for ref in sar_refs:
        for req in ("uri", "digest", "boundary"):
            if req not in ref:
                fail(f"sar evidence_ref missing '{req}'")
        if not ref["uri"].startswith(("http://", "https://")):
            fail(f"sar evidence_ref uri does not look well-formed: {ref['uri']!r}")
        if not DIGEST_RE.match(ref["digest"]):
            fail(f"sar evidence_ref digest is not well-formed sha256:<64 hex>: {ref['digest']!r}")

    # Cross-check: if result is PASS, observed and expected decisions should agree.
    if row["result"] == "PASS" and row["observed_decision"] != row["expected_decision"]:
        fail("result is PASS but observed_decision != expected_decision")

    print("PASS: result-row.example.json is structurally valid.")
    print(f"  case_id={row['case_id']} result={row['result']} "
          f"observed={row['observed_decision']} expected={row['expected_decision']} "
          f"sar_refs={len(sar_refs)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
