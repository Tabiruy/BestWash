-- =====================================================================
-- supabase-migration.sql  (jalankan sekali di Supabase -> SQL Editor)
-- Menambah kolom pembayaran, membership, prioritas & jarak ke tabel orders,
-- serta tabel memberships.
-- =====================================================================

-- 1) Kolom baru di tabel orders
alter table public.orders add column if not exists member        boolean      not null default false;
alter table public.orders add column if not exists diskon        numeric      not null default 0;      -- persen, mis. 10
alter table public.orders add column if not exists prioritas     boolean      not null default false;
alter table public.orders add column if not exists bayar         text         not null default 'Tunai'; -- Tunai | QRIS | Transfer Bank | E-Wallet
alter table public.orders add column if not exists bayar_status  text         not null default 'belum'; -- belum | lunas
alter table public.orders add column if not exists jarak         numeric;                               -- km dari laundry
alter table public.orders add column if not exists lat           double precision;
alter table public.orders add column if not exists lng           double precision;

-- 2) Berat tidak lagi diisi pelanggan (diisi kasir saat penimbangan) -> boleh 0
alter table public.orders alter column berat drop not null;
alter table public.orders alter column berat set default 0;
alter table public.orders alter column biaya set default 0;
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.orders'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%berat%'
  loop
    execute format('alter table public.orders drop constraint %I', c.conname);
  end loop;
end $$;

-- 3) Tabel membership
create table if not exists public.memberships (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  mulai      timestamptz not null default now(),
  sampai     timestamptz not null,
  metode     text,
  updated_at timestamptz not null default now()
);
alter table public.memberships enable row level security;

drop policy if exists "member_select" on public.memberships;
create policy "member_select" on public.memberships
  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "member_insert_own" on public.memberships;
create policy "member_insert_own" on public.memberships
  for insert with check (auth.uid() = user_id);

drop policy if exists "member_update_own" on public.memberships;
create policy "member_update_own" on public.memberships
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
