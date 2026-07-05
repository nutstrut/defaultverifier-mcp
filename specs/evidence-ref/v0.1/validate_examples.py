#!/usr/bin/env python3
"""Validate ds.evidence_ref.v0.1 example objects.

Stdlib-only. Uses the `jsonschema` package for full JSON Schema validation
if it is installed; otherwise falls back to basic structural checks and
reports that full schema validation was skipped.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCHEMA_PATH = HERE / "schema.json"
EXAMPLES_DIR = HERE / "examples"

REQUIRED_FIELDS = ["schema_id", "ref_id", "evidence_type", "boundary", "relation"]
LOCATOR_FIELDS = ["uri", "digest", "embedded_ref"]
EXPECTED_SCHEMA_ID = "ds.evidence_ref.v0.1"


def basic_checks(name, obj):
    errors = []

    for field in REQUIRED_FIELDS:
        if field not in obj:
            errors.append(f"missing required field: {field}")
        elif isinstance(obj[field], str) and obj[field].strip() == "":
            errors.append(f"required field is empty: {field}")

    if obj.get("schema_id") != EXPECTED_SCHEMA_ID:
        errors.append(
            f"schema_id must equal '{EXPECTED_SCHEMA_ID}', got: {obj.get('schema_id')!r}"
        )

    if not any(field in obj for field in LOCATOR_FIELDS):
        errors.append(
            f"no locator present — need at least one of: {', '.join(LOCATOR_FIELDS)}"
        )

    boundary = obj.get("boundary")
    if not isinstance(boundary, str) or boundary.strip() == "":
        errors.append("boundary must be a non-empty string")

    return errors


def try_jsonschema_validation(schema, examples):
    try:
        import jsonschema
    except ImportError:
        return None  # signal: not available

    results = {}
    validator_cls = jsonschema.validators.validator_for(schema)
    validator_cls.check_schema(schema)
    validator = validator_cls(schema)
    for name, obj in examples:
        errs = sorted(validator.iter_errors(obj), key=lambda e: e.path)
        results[name] = [e.message for e in errs]
    return results


def main():
    if not SCHEMA_PATH.exists():
        print(f"FAIL: schema not found at {SCHEMA_PATH}")
        return 1

    with open(SCHEMA_PATH) as f:
        schema = json.load(f)

    if not EXAMPLES_DIR.exists():
        print(f"FAIL: examples directory not found at {EXAMPLES_DIR}")
        return 1

    example_files = sorted(EXAMPLES_DIR.glob("*.example.json"))
    if not example_files:
        print(f"FAIL: no *.example.json files found in {EXAMPLES_DIR}")
        return 1

    examples = []
    load_errors = {}
    for path in example_files:
        try:
            with open(path) as f:
                examples.append((path.name, json.load(f)))
        except json.JSONDecodeError as e:
            load_errors[path.name] = [f"invalid JSON: {e}"]

    print("=" * 72)
    print("ds.evidence_ref.v0.1 — example validation")
    print("=" * 72)

    overall_pass = True

    print("\n-- Basic structural checks (always run) --")
    basic_results = {}
    for name, obj in examples:
        errs = basic_checks(name, obj)
        basic_results[name] = errs
        status = "PASS" if not errs else "FAIL"
        if errs:
            overall_pass = False
        print(f"[{status}] {name}")
        for e in errs:
            print(f"    - {e}")

    for name, errs in load_errors.items():
        overall_pass = False
        print(f"[FAIL] {name}")
        for e in errs:
            print(f"    - {e}")

    print("\n-- Full JSON Schema validation --")
    schema_results = try_jsonschema_validation(schema, examples)
    if schema_results is None:
        print("SKIPPED: 'jsonschema' package not installed. "
              "Only basic structural checks above were performed.")
    else:
        for name, errs in schema_results.items():
            status = "PASS" if not errs else "FAIL"
            if errs:
                overall_pass = False
            print(f"[{status}] {name}")
            for e in errs:
                print(f"    - {e}")

    print("\n" + "=" * 72)
    if overall_pass:
        print(f"SUMMARY: PASS — {len(examples)} example(s) checked, no errors.")
    else:
        print("SUMMARY: FAIL — one or more examples failed validation.")
    print("=" * 72)

    return 0 if overall_pass else 1


if __name__ == "__main__":
    sys.exit(main())
