FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm rebuild better-sqlite3 || true

COPY scripts/okapi-sidecar/requirements.txt scripts/okapi-sidecar/requirements.txt
COPY scripts/translators-server/requirements.txt scripts/translators-server/requirements.txt
RUN pip3 install --no-cache-dir \
  -r scripts/okapi-sidecar/requirements.txt \
  -r scripts/translators-server/requirements.txt

COPY . .

ENV NODE_ENV=production
ENV OKAPI_UPSTREAM_URL=http://127.0.0.1:8090
ENV MT_UPSTREAM_URL=http://127.0.0.1:8770
ENV MT_REF_PREACCELERATE=0

EXPOSE 10000

CMD ["node", "scripts/cloud-start.mjs"]
