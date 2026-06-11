# Smart-CAT 机器翻译参考服务

为编辑器「机器翻译参考」面板提供 Bing / 百度 / DeepL 等免费 MT 对照译文（基于 [translators](https://github.com/UlionTse/translators) 库，GPL-3.0）。

## 环境

- Python 3.10+

## 安装与启动

```bash
cd scripts/translators-server
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8770
```

或在项目根目录双击 `scripts/start-mt-reference.cmd`。

浏览器 CAT：**系统设置 → 机器翻译参考**，填写 `http://127.0.0.1:8770` 并启用。

## 可选环境变量

| 变量 | 说明 |
|------|------|
| `MT_REF_API_KEY` | 若设置，请求头须带 `X-API-Key: 同一值` |
| `MT_REF_PREACCELERATE=0` | 关闭启动时 translators 会话预热 |

## API

- `GET /health` → `{ ok, translators_version, pool_size }`
- `POST /translate` → body `{ text, translator, from_language, to_language }`，返回 `{ ok, text, translator, elapsed_ms }`
