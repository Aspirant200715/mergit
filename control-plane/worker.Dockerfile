# The agent worker (the `worker` service in deploy/compose.yaml), plan task O10.
#   docker build -f control-plane/worker.Dockerfile -t mergit-worker:local .
# Build from the repository root (see control-plane/Dockerfile for why).

FROM python:3.13-slim AS builder
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl build-essential pkg-config ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --profile minimal --default-toolchain 1.98
ENV PATH="/root/.cargo/bin:${PATH}"
RUN pip install --no-cache-dir uv

WORKDIR /src
COPY . .
WORKDIR /src/control-plane
RUN uv sync --locked --python 3.13 --no-dev

FROM python:3.13-slim
# git: control-plane/mergit_worker/workspace.py checks out, diffs and patches the task repo on the
# host side, outside the sandbox. docker.sock is bind-mounted at runtime (deploy/compose.yaml) so this
# process can launch sibling sandbox containers through the host daemon; it needs write access to that
# socket, so this image is NOT given a non-root user like control-plane/Dockerfile's api image is. The
# sandbox containers it creates are still locked down on their own terms regardless of this process's
# uid: no network, every capability dropped, read-only root, CPU/memory/pid limits (sandbox.py).
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /src/control-plane/.venv .venv
COPY control-plane/mergit_worker mergit_worker
# __main__.py's PR-gate worker (O9, control-plane/README.md) reads mergit_cp.pr_store directly, over
# the same database, so this is not optional the way control-plane/Dockerfile's reverse import is.
COPY control-plane/mergit_cp mergit_cp
COPY control-plane/agents.toml control-plane/prices.toml ./
COPY deploy/agents.local.json deploy/agents.local.json
COPY control-plane/worker-entrypoint.sh /usr/local/bin/worker-entrypoint.sh
RUN chmod +x /usr/local/bin/worker-entrypoint.sh
ENV PATH="/app/.venv/bin:${PATH}"
ENTRYPOINT ["/usr/local/bin/worker-entrypoint.sh"]
CMD ["python", "-m", "mergit_worker"]
