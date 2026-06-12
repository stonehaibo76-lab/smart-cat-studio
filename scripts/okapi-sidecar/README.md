# Okapi Sidecar (Smart-CAT)

Lightweight Python extract service on `http://127.0.0.1:8090`.

## Start

**随 Smart-CAT 启动（推荐）**：双击项目根目录 `启动Smart CAT Studio V 1.8.1.bat`，会自动打开 Okapi 窗口。

**单独启动**：

```cmd
scripts\start-okapi-sidecar.cmd
```

由主启动脚本调用时传 `silent` 参数，不阻塞、不 pause：

```cmd
scripts\start-okapi-sidecar.cmd silent
```

## Endpoints

- `GET /health` — service status
- `POST /extract` — multipart `file` field → `{ ok, segments[] }`

## Supported (fallback without Java Okapi)

- `.docx` — bilingual table or alternating paragraphs
- `.html` / `.htm` — text blocks
- `.txt` — one segment per line
- `.pptx` — slide shapes, tables, grouped shapes, speaker notes (run-level inlineRunMeta)

Set `OKAPI_JAR_PATH` to Supervertaler okapi-sidecar JAR for full Okapi Framework support (future).
