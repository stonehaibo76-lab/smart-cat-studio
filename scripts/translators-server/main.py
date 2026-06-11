"""
Smart-CAT 机器翻译参考 sidecar：封装 UlionTse translators 库。
启动：uvicorn main:app --host 127.0.0.1 --port 8770
环境变量（可选）：MT_REF_API_KEY、MT_REF_PREACCELERATE=0 关闭预热
"""
import os
import time
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import translators as ts

API_KEY = os.environ.get("MT_REF_API_KEY", "")
PREACCELERATE = os.environ.get("MT_REF_PREACCELERATE", "1") != "0"
MAX_TEXT_LEN = 20000
TRANSLATOR_TIMEOUT = 30.0

app = FastAPI(title="Smart-CAT MT Reference Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _check_key(x_api_key: Optional[str]):
    if API_KEY and (not x_api_key or x_api_key != API_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")


@app.on_event("startup")
def startup():
    if PREACCELERATE:
        try:
            ts.preaccelerate_and_speedtest()
        except Exception:
            pass


class TranslateRequest(BaseModel):
    text: str = Field(..., min_length=1)
    translator: str = "bing"
    from_language: str = "auto"
    to_language: str = "en"


class TranslateResponse(BaseModel):
    ok: bool
    text: str
    translator: str
    elapsed_ms: int


@app.get("/")
def root():
    return {
        "service": "Smart-CAT MT Reference",
        "status": "running",
        "translators_version": getattr(ts, "__version__", "unknown"),
        "try": {"health": "/health", "translate": "POST /translate"},
    }


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)


@app.get("/health")
def health(x_api_key: Optional[str] = Header(default=None)):
    _check_key(x_api_key)
    return {
        "ok": True,
        "translators_version": getattr(ts, "__version__", "unknown"),
        "pool_size": len(getattr(ts, "translators_pool", []) or []),
    }


@app.post("/translate", response_model=TranslateResponse)
def translate(body: TranslateRequest, x_api_key: Optional[str] = Header(default=None)):
    _check_key(x_api_key)
    translator = (body.translator or "bing").strip()
    text = body.text
    if len(text) > MAX_TEXT_LEN:
        text = text[:MAX_TEXT_LEN]

    pool = getattr(ts, "translators_pool", None) or []
    if pool and translator not in pool:
        raise HTTPException(status_code=400, detail=f"Unknown translator: {translator}")

    t0 = time.time()
    try:
        result = ts.translate_text(
            text,
            translator=translator,
            from_language=body.from_language or "auto",
            to_language=body.to_language or "en",
            timeout=TRANSLATOR_TIMEOUT,
            if_print_warning=False,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    if isinstance(result, dict):
        out = result.get("data") or result.get("text") or str(result)
    else:
        out = str(result)

    elapsed = int((time.time() - t0) * 1000)
    return TranslateResponse(ok=True, text=out.strip(), translator=translator, elapsed_ms=elapsed)
