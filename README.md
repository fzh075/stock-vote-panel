
在线访问 url：https://stock-vote-panel-web.onrender.com

Prompt 由 AI 自行完成了，关键是 “JSON Schema” 这一模型商提供的功能。：[点击跳转](#-prompt-设计强制-llm-只返回-json-不废话)

Debug 记录：
npm run setup:supabase
脚本报错，粘贴报错给 AI。AI 去掉了 dotenv 依赖，改为直接用 Node 20+ 内置的 process.loadEnvFile



# 📈 AI 股票分析面板（精简版）

> 面试题：使用 AI 工具（Cursor/Claude Code）构建一个全栈应用，调用 LLM 分析股票数据，输出严格 JSON。
> 时限：48 小时

## 🌐 在线访问 URL

| 服务 | URL |
| --- | --- |
| 前端（Static Site） | https://stock-vote-panel-web.onrender.com |
| 后端（Web Service） | https://stock-vote-panel-api.onrender.com |
| 健康检查 | https://stock-vote-panel-api.onrender.com/api/health |

> ⚠️ Render 免费档冷启动约 30-60s，第一次请求请耐心等待。

## 🧱 技术栈

- **前端**：React 18 + Vite（纯 CSS，无 UI 库，构建产物 < 100KB）
- **后端**：Node.js 20 + Express 4（ESM）
- **行情 API**：[Finnhub](https://finnhub.io) 免费 token
- **LLM**：任何 OpenAI 兼容接口（OpenAI / DeepSeek / Moonshot / 通义…）默认 `gpt-4o-mini`
- **数据库**：Supabase（Postgres + 自带 Service Role）
- **部署**：Render.com（前端 Static Site + 后端 Web Service，`render.yaml` 一键蓝图）
- **代码**：GitHub

## 📂 目录结构

```
stock-vote-panel/
├─ backend/                    # Express 后端
│  ├─ server.js                # /api/analyze /api/history /api/health
│  ├─ package.json
│  └─ .env.example
├─ frontend/                   # React + Vite 前端
│  ├─ src/{main.jsx,App.jsx,styles.css}
│  ├─ index.html
│  ├─ vite.config.js
│  └─ .env.example
├─ supabase/
│  └─ schema.sql               # analyses 表
├─ render.yaml                 # Render 一键部署
└─ README.md
```

## 🚀 本地运行

```bash
# 1. 创建 Supabase 表
#   登录 Supabase → SQL Editor → 执行 supabase/schema.sql

# 2. 后端
cd backend
cp .env.example .env          # 填入 FINNHUB / LLM / SUPABASE 三组 KEY
npm install
npm run dev                   # http://localhost:8080

# 3. 前端
cd ../frontend
cp .env.example .env          # VITE_API_BASE=http://localhost:8080
npm install
npm run dev                   # http://localhost:5173
```

## ☁️ Render 部署

仓库已包含 `render.yaml`，进 Render Dashboard → **New → Blueprint** → 选择此仓库，会自动创建两个 Service：

1. `stock-vote-panel-api` — Node Web Service（rootDir=`backend`）
2. `stock-vote-panel-web` — Static Site（rootDir=`frontend`，`dist` 输出）

部署后需要手动填入以下密钥（render.yaml 中标记为 `sync: false`）：

| Service | 变量 | 值 |
| --- | --- | --- |
| api | `FINNHUB_API_KEY` | Finnhub 免费 token |
| api | `LLM_API_KEY` | LLM API key |
| api | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase Settings → API |
| api | `FRONTEND_ORIGIN` | 前端 URL（限制 CORS） |
| web | `VITE_API_BASE` | 后端 URL |

> 修改 `VITE_API_BASE` 后需点击 Static Site 的 **Manual Deploy → Clear build cache & deploy**，否则旧值会被打进 bundle。

---

## 🧠 Prompt 设计（强制 LLM 只返回 JSON 不废话）

代码位置：[`backend/server.js`](./backend/server.js) 的 `buildMessages()` + `callLLM()`。三层防御：

### ① System Prompt 中明确"只输出 JSON"

```js
const system = `You are a senior equity analyst. You MUST respond with ONE JSON object and NOTHING else.
Rules:
- No markdown, no code fences, no commentary.
- Output schema (all fields required):
  {
    "summary": string (<=120 chars, plain English),
    "sentiment": "Bullish" | "Neutral" | "Bearish",
    "risk_level": "Low" | "Medium" | "High"
  }
- "sentiment" / "risk_level" must be EXACTLY one of the listed enum values.
- If data is insufficient, still return valid JSON with sentiment="Neutral" and risk_level="Medium".`;
```

要点：
- **角色 + 必须 + 否定**：`MUST respond with ONE JSON object and NOTHING else`
- **明确 schema**：把字段、类型、长度、枚举值都写死
- **兜底分支**：数据不足时也要给合法 JSON，避免模型转去解释而破坏结构

### ② API 调用层 `response_format: { type: 'json_object' }`

```js
body: JSON.stringify({
  model: LLM_MODEL,
  messages,
  temperature: 0.2,                       // 降低随机性
  response_format: { type: 'json_object' } // OpenAI / 兼容接口的 JSON 模式
})
```

### ③ 解析层 `safeParseJSON()` 兜底

即使模型偶尔抽风返回带围栏的 ```` ```json ... ``` ````，也能截取第一个 `{...}` 块解析；解析失败抛错并把原始文本截断 200 字记录到日志，便于复盘。

### ④ 字段校验 `validateAnalysis()`

枚举值用 `Set` 校验，非法直接 500，避免脏数据落库。

> Prompt 演进过程见下方 Debug 记录第 ②、③ 条。

---

## ✅ 题目要求自查

| 要求 | 实现位置 |
| --- | --- |
| 用户输入股票代码并调用免费 API 拉行情 | `backend/server.js` `fetchQuote()` 调 Finnhub |
| 调用 LLM 分析，**严格 JSON**，含 `summary` / `sentiment` / `risk_level` | `buildMessages()` + `response_format=json_object` + `safeParseJSON()` + `validateAnalysis()` |
| 数据落库 Supabase | `analyses` 表 + `supabase.from('analyses').insert(...)` |
| 部署 Render.com | `render.yaml` 蓝图 |
| 代码 GitHub | 本仓库 |
| README 含在线 URL | 顶部表格 |
| Prompt 截图/代码 | 上方 "Prompt 设计" 章节，附完整代码与三层防御策略 |

## 📜 License

MIT
