#!/usr/bin/env node
// scripts/verify.mjs — 三件套连通性自检：Finnhub / UIUI LLM / Supabase
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
process.loadEnvFile(fileURLToPath(new URL('../backend/.env', import.meta.url)));
const require = createRequire(fileURLToPath(new URL('../backend/package.json', import.meta.url)));
const { createClient } = require('@supabase/supabase-js');

const env = process.env;

async function check(name, fn) {
  process.stdout.write(`▶ ${name} … `);
  try {
    const msg = await fn();
    console.log(`✅ ${msg ?? 'ok'}`);
  } catch (e) {
    console.log(`❌ ${e.message}`);
    process.exitCode = 1;
  }
}

await check('Finnhub /quote AAPL', async () => {
  const r = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=AAPL&token=${env.FINNHUB_API_KEY}`
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const q = await r.json();
  if (!q.c) throw new Error('返回行情为空（key 可能无效）');
  return `current=${q.c}`;
});

await check('UIUI LLM /chat/completions', async () => {
  const r = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.LLM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.LLM_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'reply JSON: {"ok":true}' }],
      response_format: { type: 'json_object' },
      temperature: 0,
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
  const j = await r.json();
  return `model=${j.model} usage=${JSON.stringify(j.usage)}`;
});

await check('Supabase analyses table', async () => {
  if (!env.SUPABASE_URL?.startsWith('https://') || env.SUPABASE_URL.includes('YOUR_PROJECT_REF')) {
    throw new Error('SUPABASE_URL 未填，先跑 node scripts/setup-supabase.mjs');
  }
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { error, count } = await sb
    .from('analyses')
    .select('*', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return `rows=${count}`;
});
