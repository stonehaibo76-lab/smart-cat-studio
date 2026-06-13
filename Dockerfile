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
COPY scripts/okapi-sidecar/main.py scripts/okapi-sidecar/main.py
ENV PIP_BREAK_SYSTEM_PACKAGES=1
RUN pip3 install --upgrade pip \
  && pip3 install --no-cache-dir -r scripts/okapi-sidecar/requirements.txt \
  && python3 -m uvicorn --version \
  && cd scripts/okapi-sidecar && python3 -c "import main; print('okapi main import ok')"

COPY . .
RUN chmod +x scripts/render-start.sh

ENV NODE_ENV=production
ENV OKAPI_UPSTREAM_URL=http://127.0.0.1:8090
ENV SMARTCAT_SPAWN_OKAPI=0

EXPOSE 10000

CMD ["/bin/sh", "scripts/render-start.sh"]
