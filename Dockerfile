FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    TZ=America/New_York

# tzdata so TZ works for the daily reminder time and "today" calculations.
RUN apk add --no-cache tzdata \
 && mkdir -p /data \
 && chown node:node /data

WORKDIR /app

# The only runtime dependency is the Anthropic SDK, used by the optional assistant.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY seed.json ./
COPY server ./server
COPY public ./public

USER node
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
