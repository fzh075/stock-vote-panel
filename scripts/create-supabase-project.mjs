#!/usr/bin/env node
// scripts/create-supabase-project.mjs
// 用 Management API 在你账号下新建一个 Supabase 项目
// 运行：node scripts/create-supabase-project.mjs <项目名> [区域]
//   默认区域 ap-southeast-1（新加坡，离 UIUI 最近）
//   其它常用：ap-northeast-1 东京 / us-east-1 弗吉尼亚 / eu-west-1 爱尔兰
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

process.loadEnvFile(fileURLToPath(new URL('../backend/.env', import.meta.url)));

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('❌ backend/.env 里没有 SUPABASE_ACCESS_TOKEN');
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

const projectName = process.argv[2] || 'stock-vote-panel';
const region = process.argv[3] || 'ap-southeast-1';

const rl = createInterface({ input: stdin, output: stdout });
const ask = (q) => rl.question(q);

(async () => {
  console.log('🔍 拉取组织列表…');
  const orgs = await jget('https://api.supabase.com/v1/organizations');
  if (!orgs.length) {
    console.error('❌ 你账号下还没有组织，请先登录 https://supabase.com/dashboard 创建账号');
    process.exit(1);
  }
  orgs.forEach((o, i) => console.log(`  [${i}] ${o.name}  id=${o.id}`));
  const idx = orgs.length === 1 ? 0 : parseInt((await ask('选择组织序号: ')).trim()) || 0;
  const org = orgs[idx];

  // 数据库 root 密码（service_role 不依赖它，但建项目必填）
  const dbPassword = randomBytes(16).toString('base64url');
  console.log(`🔑 自动生成数据库密码（仅用于直连 Postgres，已记录在控制台）：${dbPassword}`);

  console.log(`🚀 在 [${org.name}] 创建项目 ${projectName} (region=${region}) …`);
  const proj = await jpost('https://api.supabase.com/v1/projects', {
    name: projectName,
    organization_id: org.id,
    region,
    db_pass: dbPassword,
    plan: 'free',
  });
  console.log(`✅ 项目已提交：ref=${proj.id}  status=${proj.status}`);
  console.log('⏳ 项目通常需要 30-90 秒进入 ACTIVE_HEALTHY 状态。');
  console.log('   等状态 OK 后再跑：  npm run setup:supabase   选这个新项目即可建表');

  rl.close();
})().catch((e) => {
  console.error('💥', e.message);
  process.exit(1);
});
