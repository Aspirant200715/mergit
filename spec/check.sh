#!/usr/bin/env bash
# Validates every example in spec/examples against its schema, and checks that every example in
# spec/examples/invalid fails. Needs uv (uvx). Exit 0 only when both hold.
set -uo pipefail
cd "$(dirname "$0")"
fail=0
check() { uvx -q check-jsonschema --base-uri "file://$PWD/schemas/" --schemafile "schemas/$1.json" "$2" >/dev/null 2>&1; }
for f in examples/*.json; do
  n=$(basename "$f" .json)
  if check "$n" "$f"; then echo "ok        $f"; else echo "FAIL      $f should be valid"; fail=1; fi
done
for f in examples/invalid/*.json; do
  n=$(basename "$f" .json)
  if check "$n" "$f"; then echo "FAIL      $f should be invalid"; fail=1; else echo "rejected  $f"; fi
done
for f in examples/events/*.json; do
  [ -e "$f" ] || continue
  if check event "$f"; then echo "ok        $f"; else echo "FAIL      $f should be valid"; fail=1; fi
done
for f in examples/events/invalid/*.json; do
  [ -e "$f" ] || continue
  if check event "$f"; then echo "FAIL      $f should be invalid"; fail=1; else echo "rejected  $f"; fi
done
exit $fail
