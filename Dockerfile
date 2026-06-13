FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm rebuild better-sqlite3 || true

COPY scripts/okapi-sidecar/requirements.txt scripts/okapi-sidecar/requirements.txt
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir -r scripts/okapi-sidecar/requirements.txt

COPY . .

ENV NODE_ENV=production
ENV OKAPI_UPSTREAM_URL=http://127.0.0.1:8090

EXPOSE 10000

CMD ["node", "scripts/cloud-start.mjs"]
