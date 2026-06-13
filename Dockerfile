FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    libxml2 \
    libxslt1.1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm rebuild better-sqlite3 || true

COPY scripts/okapi-sidecar/requirements.txt scripts/okapi-sidecar/requirements.txt
ENV PIP_BREAK_SYSTEM_PACKAGES=1
RUN pip3 install --upgrade pip \
  && pip3 install --no-cache-dir -r scripts/okapi-sidecar/requirements.txt

COPY . .

ENV NODE_ENV=production
ENV OKAPI_UPSTREAM_URL=http://127.0.0.1:8090

EXPOSE 10000

CMD ["node", "scripts/cloud-start.mjs"]
