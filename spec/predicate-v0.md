# Predicate `Φ`, version 0

**Status:** normative for the v0 build. Schema: [`schemas/predicate.json`](schemas/predicate.json).

A predicate is the checkable statement of what "done" means for one task. The planner drafts it, the
requester approves it, the harness runs it after the agent stops, and the validator checks the recorded
result. All four read this document.

## Shape

```json
{
  "kind": "exec/0",
  "command": ["pytest", "tests/test_refund.py", "-q"],
  "expected_exit": 0,
  "workdir": ".",
  "allowed_paths": ["payments/**"],
  "artifact_hashes": null,
  "timeout_s": 600
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | `"exec/0"` | The only kind in v0: an executable check |
| `command` | array of strings, at least one | The argv to run. No shell: `["sh", "-c", ...]` is allowed but is still one argv |
| `expected_exit` | integer | The exit code that means success |
| `workdir` | string | Directory to run in, relative to the repository root. No `..` segment, not absolute |
| `allowed_paths` | array of glob strings, or `null` | Paths the agent may change. `null` means any path |
| `artifact_hashes` | object mapping a path to a keccak-256 hash, or `null` | Files that must have exactly these contents afterwards |
| `timeout_s` | integer, 1 to 3600 | Seconds before the check counts as not run |

`phi_hash = keccak256(JCS(Φ))`, where JCS is RFC 8785 canonical JSON.

## The result

The harness runs `command` in the sandbox, in `workdir`, after the agent has stopped, and records:

```json
{
  "exit_code": 0,
  "changed_paths": ["payments/refund.py"],
  "observed_artifact_hashes": {},
  "stdout_digest": "0x…",
  "holds": true
}
```

- `changed_paths`: every path that differs from the starting commit, as `git status --porcelain` reports
  it, sorted.
- `observed_artifact_hashes`: for each path named in `artifact_hashes`, the keccak-256 of its contents
  afterwards (absent file: the path is omitted).
- `stdout_digest`: keccak-256 of the captured standard output, after the 1 MiB cap.

## When `Φ` holds

```
holds = exit_code == expected_exit
        AND (allowed_paths is null OR every changed path matches at least one allowed_paths glob)
        AND (artifact_hashes is null OR every entry equals observed_artifact_hashes[path])
```

Globs use `*` for one path segment and `**` for any number of segments. Paths use `/`.

The validator recomputes `holds` from the other fields and the approved `Φ`. A recorded `holds` that
disagrees with the recomputation makes the receipt invalid (`PHI_RESULT_CONTRADICTED`).

If the check could not run (timeout, missing command), the harness records `exit_code: -1` and
`holds: false`, and reports the task as inconclusive to the orchestrator.

## Trivial predicates

The predicate service rejects at approval time a `command` that cannot fail: `true`, `:`, `exit 0`
(directly or under `sh -c`), or `echo` alone. This is a guard against the commonest weak predicate, not a
proof that a predicate is strong (HLD R5).
