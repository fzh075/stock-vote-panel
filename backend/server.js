// server.js — AI 股票分析面板后端
// 提供 /api/analyze 接口：拉取行情 → 调用 LLM 生成严格 JSON → 落库 Supabase
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(express.json());

// ---- CORS 配置 ----
// 生产环境下用 FRONTEND_ORIGIN 显式白名单（解决 Render 部署后浏览器报 CORS 的常见问题）
const allowedOrigins = (process.env.FRONTEND_ORIGIN || '*')
  .split(',')
  .map((s) => s.trim());
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error(`CORS blocked: ${origin}`));
    },
  })
);

// ---- 环境变量 ----
const {
  PORT = 8080,
  FINNHUB_API_KEY,            // https://finnhub.io 免费 token
  LLM_API_KEY,                // OpenAI / DeepSeek / Moonshot / 任何 OpenAI 兼容
  LLM_BASE_URL = 'https://api.openai.com/v1',
  LLM_MODEL = 'gpt-4o-mini',
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

// ---- 健康检查 ----
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    supabase: Boolean(supabase),
    llm: Boolean(LLM_API_KEY),
    finnhub: Boolean(FINNHUB_API_KEY),
    time: new Date().toISOString(),
  });
});

// ---- 行情抓取 ----
async function fetchQuote(symbol) {
  if (!FINNHUB_API_KEY) throw new Error('FINNHUB_API_KEY 未配置');
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_API_KEY}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Finnhub 请求失败: ${r.status}`);
  const q = await r.json();
  // 当代码错误时 Finnhub 返回全 0
  if (!q || (q.c === 0 && q.h === 0 && q.l === 0)) {
    throw new Error(`未找到股票代码 ${symbol} 的行情`);
  }
  return {
    symbol: symbol.toUpperCase(),
    current: q.c,
    high: q.h,
    low: q.l,
    open: q.o,
    prevClose: q.pc,
    changePct: q.dp,
    change: q.d,
    timestamp: q.t,
  };
}

// ---- Prompt 构造（强制返回严格 JSON）----
// 关键技巧：
// 1) system 中明确"只能返回 JSON，不能有任何解释/Markdown/前后缀"
// 2) user 中给出 schema 示例
// 3) 调用层使用 response_format = { type: 'json_object' } 双重保险
function buildMessages(quote) {
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

  const user = `Analyze this real-time quote and return the JSON only.

Symbol: ${quote.symbol}
Current: ${quote.current}
Open: ${quote.open}
High: ${quote.high}
Low: ${quote.low}
Previous Close: ${quote.prevClose}
Change: ${quote.change} (${quote.changePct}%)`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ---- 调用 LLM ----
async function callLLM(messages) {
  if (!LLM_API_KEY) throw new Error('LLM_API_KEY 未配置');
  const r = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      temperature: 0.2,
      response_format: { type: 'json_object' }, // 双保险
    }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`LLM 请求失败 ${r.status}: ${text.slice(0, 200)}`);
  }
  const data = await r.json();
  const content = data?.choices?.[0]?.message?.content ?? '';
  return content;
}

// ---- 安全 JSON 解析（兼容个别 LLM 仍带 Markdown 围栏的情况）----
function safeParseJSON(raw) {
  if (!raw) throw new Error('LLM 返回为空');
  let text = raw.trim();
  // 去掉可能的 ```json ... ``` 围栏
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  }
  // 仅截取第一个 { ... } 段
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON 解析失败: ${e.message} | raw=${raw.slice(0, 200)}`);
  }
}

const SENTIMENTS = new Set(['Bullish', 'Neutral', 'Bearish']);
const RISKS = new Set(['Low', 'Medium', 'High']);

function validateAnalysis(a) {
  if (!a || typeof a !== 'object') throw new Error('analysis 不是对象');
  if (typeof a.summary !== 'string' || !a.summary.trim()) throw new Error('summary 字段非法');
  if (!SENTIMENTS.has(a.sentiment)) throw new Error(`sentiment 非法: ${a.sentiment}`);
  if (!RISKS.has(a.risk_level)) throw new Error(`risk_level 非法: ${a.risk_level}`);
  return {
    summary: a.summary.trim(),
    sentiment: a.sentiment,
    risk_level: a.risk_level,
  };
}

// ---- 主接口 ----
app.post('/api/analyze', async (req, res) => {
  const symbol = (req.body?.symbol || '').toString().trim().toUpperCase();
  if (!symbol || !/^[A-Z.\-]{1,10}$/.test(symbol)) {
    return res.status(400).json({ error: '请输入合法的股票代码（如 AAPL、TSLA）' });
  }

  try {
    // 1) 拉行情
    const quote = await fetchQuote(symbol);

    // 2) 调 LLM
    const messages = buildMessages(quote);
    const raw = await callLLM(messages);
    const parsed = safeParseJSON(raw);
    const analysis = validateAnalysis(parsed);

    // 3) 写入 Supabase（失败不阻塞响应，仅记录）
    let storedId = null;
    if (supabase) {
      const { data, error } = await supabase
        .from('analyses')
        .insert({
          symbol: quote.symbol,
          quote,
          summary: analysis.summary,
          sentiment: analysis.sentiment,
          risk_level: analysis.risk_level,
          raw_llm: raw,
        })
        .select('id')
        .single();
      if (error) {
        console.error('[supabase] insert error:', error.message);
      } else {
        storedId = data?.id ?? null;
      }
    }

    return res.json({
      id: storedId,
      symbol: quote.symbol,
      quote,
      analysis,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[analyze] error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ---- 历史记录 ----
app.get('/api/history', async (req, res) => {
  if (!supabase) return res.json({ items: [] });
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const { data, error } = await supabase
    .from('analyses')
    .select('id, symbol, summary, sentiment, risk_level, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ items: data });
});

app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});
