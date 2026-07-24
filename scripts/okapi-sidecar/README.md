# Okapi Sidecar (Smart-CAT)

Two local services support format-preserving import/export:

| Port | Runtime | Formats |
|------|---------|---------|
| **8090** | Python (uvicorn) | **DOCX**, HTML, TXT |
| **8091** | Java Okapi (`okapi-sidecar.jar`) | **PPTX, XLSX** (Supervertaler-style `okf_openxml`) |

## Start (local dev)

**Recommended** — main launcher starts both:

```cmd
启动Smart CAT Studio V 1.8.3.1.bat
```

Portable package: `runtime/node/node.exe scripts/packaging/smartcat-launcher.mjs`

Or individually:

```cmd
scripts\start-okapi-sidecar.cmd
scripts\start-okapi-java-sidecar.cmd
```

Bundled JRE (Windows portable): run `scripts\packaging\fetch-jre.ps1` once to populate `runtime/jre/`.

## Endpoints (Python, 8090)

- `GET /health` — service status
- `POST /extract` — multipart `file` → `{ ok, segments[] }`
- `POST /merge` — multipart `file` + `segments_json`

## Endpoints (Java, 8091)

Same paths as Supervertaler Okapi sidecar:

- `GET /health` — `{ status: "ok", version: "0.1.7" }`
- `POST /extract` — multipart `file` + `source_lang`, `target_lang`, `segment`
- `POST /merge` — multipart `original` + `translations` JSON array

JAR location: `binaries/okapi-java-sidecar/okapi-sidecar.jar` (see that folder's README).

## Node API proxy

The DB server (`58741`) exposes `/api/okapi/*` and routes `.pptx`, `.xlsx` to Java (8091); `.docx`, HTML/TXT to Python (8090).

Health: `GET /api/okapi/health` returns `officeOkapiSupported: true` (and `xlsxSupported: true`) when Java sidecar is up.

Bilingual CAT DOCX (table/interleaved import) still uses browser-side TS parsing; mono Office import/export uses Java Okapi.
