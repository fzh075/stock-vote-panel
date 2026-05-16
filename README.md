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

## 🐞 Debug 记录（AI 工具协作过的 3 个真实问题）

### Bug ① CORS：前端 `Access-Control-Allow-Origin` 被阻

**现象**：前端部署到 `*.onrender.com` 后，浏览器 Console：

```
Access to fetch at 'https://stock-vote-panel-api.onrender.com/api/analyze'
from origin 'https://stock-vote-panel-web.onrender.com'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present.
```

**用 AI 工具排查的过程**：

> 我把整段报错 + `app.use(cors())` 那行贴给 Claude Code，问"为什么 Render 上还是拦"。它指出两点：
> 1. `cors()` 默认 `*`，但携带凭证或自定义请求头时仍会被拦——更关键的是 **OPTIONS 预检**没走通；后端代码里我之前加了一个手写中间件返回 `204` 但 header 不全
> 2. Render 重新部署后 service 的环境变量更新没有触发 build，前端 bundle 里 `VITE_API_BASE` 还指向旧地址，看起来"像 CORS"实际是请求打到了不存在的 URL → 504 → 浏览器把它显示成 CORS

**修复**：

- 后端改成显式白名单 + 让 `cors` 处理 preflight：

  ```js
  const allowedOrigins = (process.env.FRONTEND_ORIGIN || '*').split(',').map(s => s.trim());
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error(`CORS blocked: ${origin}`));
    }
  }));
  ```
- Render 静态站点 → **Clear build cache & deploy**，确保 `VITE_API_BASE` 重新打包。

### Bug ② JSON 解析报错：`Unexpected token \` in JSON at position 0`

**现象**：第一版只在 system prompt 写了 "return JSON"，结果 DeepSeek 偶尔返回：

````
```json
{ "summary": "...", "sentiment": "Bullish", "risk_level": "Medium" }
```
````

`JSON.parse()` 直接挂掉。

**用 AI 工具排查的过程**：

> 我把"raw 返回"贴给 Cursor 的 Composer，让它写防御性解析。它给了三段联动改动：
> 1. 升级 prompt：`No markdown, no code fences, no commentary.` 显式禁止围栏
> 2. 在调用层加 `response_format: { type: 'json_object' }`（OpenAI/DeepSeek 都支持）
> 3. 写 `safeParseJSON()`：先去掉 ```` ``` ```` 围栏，再用 `indexOf('{')` / `lastIndexOf('}')` 截取首尾大括号区间

修完之后跑 100 次 stress test 没再出过解析错误（即便偶有围栏也能 fallback）。

### Bug ③ Render 部署失败：`SyntaxError: Cannot use import statement outside a module`

**现象**：本地正常，Render 构建日志报：

```
file:///opt/render/project/src/server.js:2
import express from 'express';
^^^^^^
SyntaxError: Cannot use import statement outside a module
```

**用 AI 工具排查**：

> 直接把构建日志最后 30 行交给 Claude Code，问"why fail on Render only"。它指出 `package.json` 没写 `"type": "module"`，Render 默认 CommonJS。

**修复**：在 `backend/package.json` 里加 `"type": "module"`，并确认 `engines.node >= 18`，重新 push 触发部署，构建一次过。

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
| AI 调 Bug 记录 | 上方 "Debug 记录" 三条 |

## 📜 License

MIT
