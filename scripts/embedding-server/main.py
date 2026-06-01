"""
本地 Embedding 服务：供 Smart-CAT 知识库 RAG 向量化检索。
启动：uvicorn main:app --host 127.0.0.1 --port 8765
环境变量（可选）：EMBED_API_KEY=你的密钥；EMBED_MODEL=模型名（默认多语小模型）
"""
import os
from typing import List, Optional

from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer

MODEL_NAME = os.environ.get(
    "EMBED_MODEL",
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
)
API_KEY = os.environ.get("EMBED_API_KEY", "")

app = FastAPI(title="Smart-CAT Embedding Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_model: Optional[SentenceTransformer] = None


def get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer(MODEL_NAME)
    return _model


@app.on_event("startup")
def startup():
    get_model()


class EmbedRequest(BaseModel):
    inputs: List[str] = Field(..., min_length=1, max_length=256)


class EmbedResponse(BaseModel):
    model: str
    dimension: int
    vectors: List[List[float]]


def _check_key(x_api_key: Optional[str]):
    if API_KEY and (not x_api_key or x_api_key != API_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")


@app.get("/")
def root():
    """浏览器打开根路径时说明用途；CAT 只调用 /health 与 POST /embed。"""
    return {
        "service": "Smart-CAT Embedding",
        "status": "running",
        "try": {
            "health": "/health",
            "api_docs": "/docs",
            "embed": "POST /embed JSON {\"inputs\": [\"句子1\"]}",
        },
    }


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    """避免浏览器请求图标时在日志里刷 404。"""
    return Response(status_code=204)


@app.get("/health")
def health():
    m = get_model()
    dim = m.get_sentence_embedding_dimension()
    return {"ok": True, "model": MODEL_NAME, "dimension": dim}


@app.post("/embed", response_model=EmbedResponse)
def embed(body: EmbedRequest, x_api_key: Optional[str] = Header(default=None)):
    _check_key(x_api_key)
    # 空串仍占一条时跳过问题由前端保证
    texts = [t if isinstance(t, str) else "" for t in body.inputs]
    m = get_model()
    mat = m.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    vecs = mat.tolist()
    dim = len(vecs[0]) if vecs else m.get_sentence_embedding_dimension()
    return EmbedResponse(model=MODEL_NAME, dimension=dim, vectors=vecs)
