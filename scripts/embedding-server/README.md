# Smart-CAT 本地 Embedding 服务

为浏览器端 CAT 提供 **文本向量**，用于知识库 **语义 RAG**（余弦相似度检索）。

## 环境

- Python 3.10+
- 首次运行会下载模型（默认 `paraphrase-multilingual-MiniLM-L12-v2`，约 400MB+）

## 安装与启动

```bash
cd scripts/embedding-server
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8765
```

浏览器 CAT：**系统设置 → 知识库向量化**，填写服务地址 `http://127.0.0.1:8765` 并启用。

## 可选环境变量

| 变量 | 说明 |
|------|------|
| `EMBED_API_KEY` | 若设置，请求头须带 `X-API-Key: 同一值` |
| `EMBED_MODEL` | 替换 `sentence_transformers` 模型名 |

## API

- `GET /health` → `{ ok, model, dimension }`
- `POST /embed` → body `{ "inputs": ["句1", "句2"] }`，返回 `{ model, dimension, vectors }`（向量已 L2 归一化）
