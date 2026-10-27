# mergit_receipt (Python binding)

The Python face of the Rust receipt builder and verifier. Every hash, id and signature is computed in Rust;
never re-implement any of it in Python. API: [`mergit_receipt.pyi`](mergit_receipt.pyi). Format:
[`spec/receipt-v0.md`](../../spec/receipt-v0.md).

## Use from `control-plane`

```toml
# control-plane/pyproject.toml
[project]
dependencies = ["mergit-receipt"]

[tool.uv.sources]
mergit-receipt = { path = "../runtime/py" }
```

`uv sync` builds it with maturin (needs a Rust toolchain, 1.98 or later).

## Develop

```bash
cd runtime/py
uv venv && uv pip install maturin pytest
uv run maturin develop
uv run pytest
```

## Rules the binding enforces

- `add_step("phi_eval", ...)` raises: only `seal_with_phi` appends the `phi_eval` step, after the agent stops.
- `seal_with_phi` raises if the result's `holds` disagrees with the predicate, or the key is not the header's
  `attestation.dev_key`.
- A builder cannot be used after sealing.
