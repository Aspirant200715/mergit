# Sandbox image: the toolchain the agent's commands and Φ run with. No credentials, no network at run time.
#   docker build -t mergit-sandbox:dev control-plane/sandbox
# The container runs as the worker's uid:gid with a read-only root, so nothing is installed at run time.
FROM python:3.13-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates nodejs npm make \
 && rm -rf /var/lib/apt/lists/*

# Test runners and common tooling, pinned loosely: repositories bring their own dependencies through
# the checkout, and the container has no network to fetch more.
RUN pip install --no-cache-dir pytest pytest-timeout pytest-xdist hypothesis ruff

WORKDIR /workspace
CMD ["sleep", "infinity"]
