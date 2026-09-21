FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    TZ=America/New_York

# tzdata so TZ works for the daily reminder time and "today" calculations.
RUN apk add --no-cache tzdata \
 && mkdir -p /data \
 && chown node:node /data

# Litestream continuously copies the database to Azure Blob Storage (used only in Azure; it does
# nothing unless server/bootstrap.js is the start command). Pinned by version and checksum.
ARG TARGETARCH
ARG LITESTREAM_VERSION=0.5.17
ARG LITESTREAM_SHA256_AMD64=cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d
ARG LITESTREAM_SHA256_ARM64=f8ca4a050095c1efbda2c4365172e61bf9d955ea0d9ac42f448b52e51819baa5
RUN set -eu; \
    case "${TARGETARCH}" in \
      amd64) arch=x86_64; sha="${LITESTREAM_SHA256_AMD64}" ;; \
      arm64) arch=arm64; sha="${LITESTREAM_SHA256_ARM64}" ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    wget -q -O /tmp/litestream.tgz "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-${arch}.tar.gz"; \
    echo "${sha}  /tmp/litestream.tgz" | sha256sum -c -; \
    mkdir /tmp/litestream; \
    tar -xzf /tmp/litestream.tgz -C /tmp/litestream; \
    install -m 0755 "$(find /tmp/litestream -type f -name litestream | head -n 1)" /usr/local/bin/litestream; \
    litestream version; \
    rm -rf /tmp/litestream /tmp/litestream.tgz

WORKDIR /app

# Runtime dependencies: the Anthropic SDK (optional assistant) and the Azure SDKs (used only when
# STORAGE_BACKEND=azure-blob or the Azure start command is used).
COPY package.json package-lock.json ./
# The package manager is only needed to install the dependencies above. It is removed afterwards
# (the app runs with plain `node`), which keeps npm's own bundled libraries, and their vulnerabilities,
# out of the image that actually runs.
RUN npm ci --omit=dev && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* /root/.npm

COPY seed.json ./
COPY server ./server
COPY public ./public

USER node
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
