-- supabase/schema.sql
-- 在 Supabase Studio → SQL Editor 粘贴执行
-- 表：analyses（保存每次分析结果）

create table if not exists public.analyses (
  id          bigserial primary key,
  symbol      text not null,
  quote       jsonb,
  summary     text not null,
  sentiment   text not null check (sentiment in ('Bullish','Neutral','Bearish')),
  risk_level  text not null check (risk_level in ('Low','Medium','High')),
  raw_llm     text,
  created_at  timestamptz not null default now()
);

create index if not exists analyses_symbol_idx     on public.analyses (symbol);
create index if not exists analyses_created_at_idx on public.analyses (created_at desc);

-- 后端使用 Service Role Key，无需开放 RLS。
-- 如果想直接从浏览器读，再开 RLS 并加策略：
-- alter table public.analyses enable row level security;
-- create policy "read analyses" on public.analyses for select using (true);
