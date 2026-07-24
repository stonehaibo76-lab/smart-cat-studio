# Okapi Java Sidecar (DOCX / PPTX / XLSX)

Supervertaler `okapi-sidecar.jar` (v0.1.7) — Okapi Framework `okf_openxml` for Office round-trip.

## File

Place `okapi-sidecar.jar` in this directory (same as release asset `okapi-sidecar-v0.1.7.jar`).

Download:

```text
https://github.com/Supervertaler/Supervertaler-Workbench/releases/download/v1.9.484/okapi-sidecar-v0.1.7.jar
```

Rename to `okapi-sidecar.jar` after download.

## Requirements

- Java 17+ (portable builds: `runtime/jre/` via `scripts/packaging/fetch-jre.ps1`)
- Listens on port **8091** (Python sidecar on **8090** handles HTML/TXT only)

## Start

Windows: `scripts\start-okapi-java-sidecar.cmd`

Linux/macOS: `sh scripts/okapi-java-sidecar/start.sh`
