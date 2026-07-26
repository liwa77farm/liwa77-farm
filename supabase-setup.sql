-- شغّل هذا الملف مرة واحدة داخل Supabase: SQL Editor > New query > Run
create extension if not exists pgcrypto;

create table if not exists public.farm_records (
  id text primary key,
  farm_id text not null,
  category text not null check (category in ('harvest','trees','maintenance','irrigation','tasks','expenses','inventory')),
  record_data jsonb not null default '{}'::jsonb,
  recorded_by text,
  record_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists farm_records_farm_id_idx on public.farm_records (farm_id);
create index if not exists farm_records_category_idx on public.farm_records (category);
create index if not exists farm_records_updated_at_idx on public.farm_records (updated_at desc);

alter table public.farm_records enable row level security;

drop policy if exists "liwa77 read" on public.farm_records;
drop policy if exists "liwa77 insert" on public.farm_records;
drop policy if exists "liwa77 update" on public.farm_records;
drop policy if exists "liwa77 delete" on public.farm_records;

create policy "liwa77 read" on public.farm_records for select to anon, authenticated using (farm_id = 'liwa77');
create policy "liwa77 insert" on public.farm_records for insert to anon, authenticated with check (farm_id = 'liwa77');
create policy "liwa77 update" on public.farm_records for update to anon, authenticated using (farm_id = 'liwa77') with check (farm_id = 'liwa77');
create policy "liwa77 delete" on public.farm_records for delete to anon, authenticated using (farm_id = 'liwa77');

do $$
begin
  alter publication supabase_realtime add table public.farm_records;
exception
  when duplicate_object then null;
end $$;
