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

-- =====================================================================
-- 4) Membership bertingkat (Bronze / Silver / Gold) + bonus poin
--    Benefit per tingkat ada di MEMBER_TIERS (orders-api.js):
--      Bronze: diskon 10% | poin +0%  | prioritas 1
--      Silver: diskon 15% | poin +25% | prioritas 2
--      Gold  : diskon 20% | poin +50% | prioritas 3 (paling depan)
-- =====================================================================
alter table public.memberships add column if not exists tier text not null default 'bronze';  -- bronze | silver | gold
alter table public.orders add column if not exists member_tier text;                          -- tingkat member saat memesan
alter table public.orders add column if not exists bonus_poin  integer not null default 0;    -- % bonus poin saat memesan

-- =====================================================================
-- 5) Voucher diskon (persen) hasil tukar poin
--    Poin per pesanan SELESAI (status 5) = floor(total / 1000), ditambah bonus poin member.
--    Poin terpakai = jumlah poin pada semua voucher yang pernah ditukar.
--    Pilihan (harus sama dengan VOUCHERS di orders-api.js):
--      1000 poin -> diskon 10% | 2000 poin -> 20% | 2500 poin -> 30%
-- =====================================================================
alter table public.orders add column if not exists voucher_persen numeric not null default 0;  -- % potongan voucher
alter table public.orders add column if not exists voucher_id      text;

create table if not exists public.vouchers (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  persen     integer,                                -- potongan (%)
  poin       integer not null,                       -- poin yang ditukar
  status     text not null default 'aktif',          -- aktif | terpakai
  created_at timestamptz not null default now(),
  used_at    timestamptz
);

-- Jika sebelumnya memakai voucher nominal (Rupiah): ubah struktur & hapus voucher lama.
-- Poin dari voucher lama otomatis kembali karena saldo = poin didapat - poin pada voucher yang ada.
alter table public.vouchers add column if not exists persen integer;
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'vouchers' and column_name = 'nilai') then
    alter table public.vouchers alter column nilai drop not null;
  end if;
end $$;
delete from public.vouchers where persen is null;
alter table public.vouchers alter column persen set not null;

alter table public.vouchers enable row level security;

-- User hanya boleh MELIHAT vouchernya; membuat/memakai lewat fungsi di bawah
drop policy if exists "voucher_select" on public.vouchers;
create policy "voucher_select" on public.vouchers
  for select using (auth.uid() = user_id or public.is_admin());

-- Tukar poin -> voucher (saldo poin dicek di server)
create or replace function public.redeem_voucher(p_poin integer)
returns public.vouchers
language plpgsql security definer set search_path = public as $$
declare
  v_persen integer; v_earned integer; v_spent integer; r public.vouchers;
begin
  if auth.uid() is null then raise exception 'Belum login'; end if;
  v_persen := case p_poin when 1000 then 10 when 2000 then 20 when 2500 then 30 else null end;
  if v_persen is null then raise exception 'Pilihan voucher tidak valid'; end if;

  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
  select coalesce(sum(floor(floor(total / 1000) * (100 + coalesce(bonus_poin, 0)) / 100)), 0) into v_earned
    from public.orders where user_id = auth.uid() and status = 5;
  select coalesce(sum(poin), 0) into v_spent
    from public.vouchers where user_id = auth.uid();
  if v_earned - v_spent < p_poin then raise exception 'Poin tidak cukup'; end if;

  insert into public.vouchers (user_id, persen, poin)
  values (auth.uid(), v_persen, p_poin) returning * into r;
  return r;
end $$;

-- Pakai voucher saat memesan (mengembalikan persen potongan)
create or replace function public.use_voucher(p_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  update public.vouchers set status = 'terpakai', used_at = now()
   where id = p_id and user_id = auth.uid() and status = 'aktif'
  returning persen into v;
  if v is null then raise exception 'Voucher tidak valid atau sudah dipakai'; end if;
  return v;
end $$;

-- Batalkan pemakaian jika pesanan gagal dibuat
create or replace function public.release_voucher(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.vouchers set status = 'aktif', used_at = null
   where id = p_id and user_id = auth.uid() and status = 'terpakai'
     and not exists (select 1 from public.orders where voucher_id = p_id::text);
end $$;

grant execute on function public.redeem_voucher(integer) to authenticated;
grant execute on function public.use_voucher(uuid)       to authenticated;
grant execute on function public.release_voucher(uuid)   to authenticated;
