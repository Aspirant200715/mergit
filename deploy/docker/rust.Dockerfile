# One image with every Rust service. Each host service picks its binary as the command:
#   mergit-store, mergit-gateway, mergit-validator (and the mergit-verify and mergit-adjudicate CLIs).
# Build from the repository root: docker build -f deploy/docker/rust.Dockerfile -t mergit-rust .
FROM rust:1.98-slim-bookworm AS chef
RUN cargo install cargo-chef --locked
WORKDIR /src

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /src/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json -p mergit-store -p mergit-gateway -p mergit-validator -p mergit-verifier
COPY . .
RUN cargo build --release --bins -p mergit-store -p mergit-gateway -p mergit-validator -p mergit-verifier

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 mergit \
    && mkdir -p /data && chown mergit /data
COPY --from=builder /src/target/release/mergit-store /src/target/release/mergit-gateway \
     /src/target/release/mergit-validator /src/target/release/mergit-verify \
     /src/target/release/mergit-adjudicate /usr/local/bin/
USER mergit
