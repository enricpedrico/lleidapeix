FROM node:24-bookworm-slim AS web-build
WORKDIR /build
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY tsconfig.json vite.config.ts ./
COPY web ./web
RUN npm run build

FROM rust:1.86-bookworm AS rust-build
WORKDIR /build
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
RUN cargo test --locked --release \
    && cargo build --locked --release

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates wget \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 app \
    && useradd --uid 1000 --gid app --home-dir /app --shell /usr/sbin/nologin app
WORKDIR /app
ENV BIND_ADDRESS=0.0.0.0
COPY --from=rust-build /build/target/release/lleidapeix /app/lleidapeix
COPY --from=web-build /build/web-dist /app/web-dist
RUN mkdir -p /app/data && chown app:app /app/data
USER app
EXPOSE 3085
CMD ["/app/lleidapeix"]
