# CI-only local image build. No registry push, secret args or host credentials.
FROM node:22.23.4-bookworm-slim AS prepared
WORKDIR /opt/depress
COPY package.json package-lock.json ./
COPY packages ./packages
COPY examples/mamas-blog/package.json ./examples/mamas-blog/package.json
COPY infra/hosted/workload.mjs infra/hosted/collect-artifact.mjs infra/hosted/protocol.mjs infra/hosted/prepare-cache.mjs infra/hosted/fixture.xml ./infra/hosted/
RUN npm ci --ignore-scripts --legacy-peer-deps --no-audit --no-fund \
 && node infra/hosted/prepare-cache.mjs

# Discard base image Env (NODE_VERSION/YARN_VERSION), volumes and entrypoint.
# Only public dependencies/repository source are copied, never CI .git/.env/home.
FROM scratch AS worker
COPY --from=prepared / /
WORKDIR /work
ENTRYPOINT ["/usr/local/bin/node", "/opt/depress/infra/hosted/workload.mjs"]

FROM worker AS probe
COPY infra/hosted/integration/probe.mjs /opt/probe.mjs
ENTRYPOINT ["/usr/local/bin/node", "/opt/probe.mjs"]
