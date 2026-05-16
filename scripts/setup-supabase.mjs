#!/usr/bin/env node
// scripts/setup-supabase.mjs
// 用 Supabase Management API（sbp_ token）自动：
//   1) 列出你账号下的项目，让你选一个
//   2) 在该项目里执行 supabase/schema.sql 建表
//   3) 拉出 Project URL 和 service_role key，回写到 backend/.env
//
// 运行：node scripts/setup-supabase.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
process.loadEnvFile(fileURLToPath(new URL('../backend/.env', import.meta.url)));
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('❌ 请在 backend/.env 中设置 SUPABASE_ACCESS_TOKEN（sbp_ 开头）');
  process.exit(1);
}

const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function jget(url) {
  const r = await fetch(url, { headers: H });
  if (!r.ok) throw new Error(`${url} → ${r.status} ${await r.text()}`);
  return r.json();
}
async function jpost(url, body) {
  const r = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${url} → ${r.status} ${await r.text()}`);
  return r.json();
}

const rl = createInterface({ input: stdin, output: stdout });
const ask = (q) => rl.question(q);

(async () => {
  console.log('🔍 拉取项目列表…');
  const projects = await jget('https://api.supabase.com/v1/projects');
  if (!projects.length) {
    console.error('❌ 你的账号下没有 Supabase 项目，请先在 https://supabase.com/dashboard 创建一个');
    process.exit(1);
  }
  projects.forEach((p, i) =>
    console.log(`  [${i}] ${p.name}  ref=${p.id}  region=${p.region}  status=${p.status}`)
  );
  const idx = parseInt((await ask('选择项目序号: ')).trim()) || 0;
  const proj = projects[idx];
  console.log(`✅ 选中：${proj.name} (${proj.id})`);

  // 1) 建表
  const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  console.log('🧱 在项目中执行 schema.sql…');
  await jpost(`https://api.supabase.com/v1/projects/${proj.id}/database/query`, { query: sql });
  console.log('✅ analyses 表已就绪');

  // 2) 拿 service_role key
  console.log('🔑 拉取 API keys…');
  const keys = await jget(`https://api.supabase.com/v1/projects/${proj.id}/api-keys`);
  const service = keys.find((k) => k.name === 'service_role');
  if (!service) throw new Error('未找到 service_role key');

  const url = `https://${proj.id}.supabase.co`;
  console.log(`📦 SUPABASE_URL=${url}`);
  console.log(`📦 SUPABASE_SERVICE_ROLE_KEY=${service.api_key.slice(0, 12)}…(已隐藏)`);

  // 3) 写回 .env
  const envPath = new URL('../backend/.env', import.meta.url);
  let env = readFileSync(envPath, 'utf8');
  env = env.replace(/^SUPABASE_URL=.*$/m, `SUPABASE_URL=${url}`);
  env = env.replace(
    /^SUPABASE_SERVICE_ROLE_KEY=.*$/m,
    `SUPABASE_SERVICE_ROLE_KEY=${service.api_key}`
  );
  writeFileSync(envPath, env);
  console.log('✅ backend/.env 已更新');

  rl.close();
})().catch((e) => {
  console.error('💥', e.message);
  process.exit(1);
});
