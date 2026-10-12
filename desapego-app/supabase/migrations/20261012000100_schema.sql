-- Desapego da Família — estrutura do banco
-- Valores em dinheiro: sempre centavos inteiros (bigint). Percentuais: pontos-base (500 = 5%).
-- Nada de ponto flutuante em cálculo financeiro.

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------- tipos
create type public.user_role as enum ('member', 'moderator', 'admin');
create type public.account_status as enum ('pending', 'active', 'suspended', 'deleted');
create type public.listing_condition as enum ('novo', 'seminovo', 'usado');
create type public.listing_type as enum ('venda', 'doacao');
create type public.listing_status as enum ('draft', 'pending_review', 'active', 'paused', 'reserved', 'sold', 'suspended', 'deleted');
create type public.offer_status as enum ('pending', 'countered', 'accepted', 'rejected', 'cancelled');
create type public.sale_type as enum ('venda', 'troca', 'doacao');
create type public.sale_status as enum ('completed', 'cancelled');
create type public.buyer_confirmation as enum ('not_applicable', 'pending', 'confirmed', 'disputed');
create type public.commission_status as enum ('awaiting_payment', 'payment_reported', 'under_review', 'paid', 'cancelled', 'refunded', 'waived');
create type public.payment_report_status as enum ('submitted', 'accepted', 'rejected');
create type public.report_status as enum ('open', 'resolved', 'dismissed');

-- ---------------------------------------------------------------- pessoas
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 60),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 500),
  location text check (location is null or char_length(location) <= 80),
  contact_preferences jsonb not null default '{"whatsapp_in_chat": false}'::jsonb,
  role public.user_role not null default 'member',
  account_status public.account_status not null default 'pending',
  terms_accepted_at timestamptz,
  terms_version text,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- dados que nunca aparecem para outros membros
create table public.profile_private (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  phone text check (phone is null or char_length(phone) <= 30),
  updated_at timestamptz not null default now()
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  label text check (label is null or char_length(label) <= 80),
  grants_role public.user_role not null default 'member' check (grants_role in ('member', 'admin')),
  created_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null,
  max_uses int not null default 1 check (max_uses between 1 and 200),
  use_count int not null default 0 check (use_count >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.user_blocks (
  blocker_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- ---------------------------------------------------------------- catálogo
create table public.categories (
  id text primary key check (id ~ '^[a-z0-9-]{2,30}$'),
  name text not null check (char_length(name) between 2 and 40),
  icon text not null default 'package',
  sort_order int not null default 100,
  active boolean not null default true
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  category_id text not null references public.categories (id),
  title text not null check (char_length(btrim(title)) between 3 and 80),
  description text not null default '' check (char_length(description) <= 4000),
  asking_price_cents bigint not null check (asking_price_cents between 0 and 100000000000),
  condition public.listing_condition not null,
  listing_type public.listing_type not null default 'venda',
  accepts_offers boolean not null default true,
  accepts_trade boolean not null default false,
  location text check (location is null or char_length(location) <= 80),
  delivery_options text[] not null default array['retirada']
    check (cardinality(delivery_options) >= 1 and delivery_options <@ array['retirada', 'entrega', 'envio']),
  notes text check (notes is null or char_length(notes) <= 500),
  status public.listing_status not null default 'draft',
  cover_path text,
  cover_thumb_path text,
  image_count int not null default 0,
  search tsvector generated always as (
    to_tsvector('portuguese', coalesce(title, '') || ' ' || coalesce(description, ''))
  ) stored,
  published_at timestamptz,
  sold_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint donation_is_free check (listing_type <> 'doacao' or asking_price_cents = 0),
  constraint sale_has_price check (listing_type <> 'venda' or asking_price_cents > 0)
);
create index listings_feed_idx on public.listings (status, published_at desc);
create index listings_category_idx on public.listings (category_id, status, published_at desc);
create index listings_seller_idx on public.listings (seller_id, status);
create index listings_price_idx on public.listings (status, asking_price_cents);
create index listings_search_idx on public.listings using gin (search);

create table public.listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  storage_path text not null check (char_length(storage_path) <= 300),
  thumb_path text not null check (char_length(thumb_path) <= 300),
  width int check (width between 1 and 10000),
  height int check (height between 1 and 10000),
  display_order smallint not null default 0 check (display_order between 0 and 50),
  created_at timestamptz not null default now()
);
create index listing_images_listing_idx on public.listing_images (listing_id, display_order);

create table public.favorites (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
create index favorites_listing_idx on public.favorites (listing_id);

-- ---------------------------------------------------------------- negociação
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  last_message_at timestamptz not null default now(),
  last_message_preview text,
  created_at timestamptz not null default now(),
  unique (listing_id, buyer_id),
  check (buyer_id <> seller_id)
);
create index conversations_buyer_idx on public.conversations (buyer_id, last_message_at desc);
create index conversations_seller_idx on public.conversations (seller_id, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'offer', 'system', 'whatsapp', 'sale')),
  content text not null check (char_length(btrim(content)) between 1 and 2000),
  metadata jsonb not null default '{}'::jsonb,
  client_id uuid unique,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_unread_idx on public.messages (conversation_id, sender_id) where read_at is null;
create index messages_sender_recent_idx on public.messages (sender_id, created_at desc);

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  proposed_by uuid not null references public.profiles (id) on delete cascade,
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  status public.offer_status not null default 'pending',
  parent_offer_id uuid references public.offers (id) on delete set null,
  client_id uuid unique,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  check (proposed_by in (buyer_id, seller_id)),
  check (buyer_id <> seller_id)
);
-- no máximo uma proposta em aberto por comprador e anúncio
create unique index offers_one_pending_idx on public.offers (listing_id, buyer_id) where status = 'pending';
create index offers_buyer_idx on public.offers (buyer_id, created_at desc);
create index offers_seller_idx on public.offers (seller_id, created_at desc);

-- ---------------------------------------------------------------- vendas e comissões
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete restrict,
  seller_id uuid not null references public.profiles (id) on delete restrict,
  buyer_id uuid references public.profiles (id) on delete set null,
  buyer_external_name text check (buyer_external_name is null or char_length(buyer_external_name) <= 80),
  offer_id uuid references public.offers (id) on delete set null,
  sale_type public.sale_type not null default 'venda',
  final_price_cents bigint not null check (final_price_cents between 0 and 100000000000),
  commission_rate_snapshot int not null check (commission_rate_snapshot between 0 and 5000), -- pontos-base
  commission_cents bigint not null default 0 check (commission_cents >= 0),
  completion_status public.sale_status not null default 'completed',
  buyer_confirmation public.buyer_confirmation not null default 'not_applicable',
  buyer_confirmed_at timestamptz,
  buyer_note text check (buyer_note is null or char_length(buyer_note) <= 500),
  completed_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  client_request_id uuid unique,
  created_at timestamptz not null default now(),
  check (buyer_id is null or buyer_id <> seller_id),
  check (sale_type <> 'venda' or final_price_cents > 0)
);
-- um anúncio só pode ter uma venda concluída válida
create unique index sales_one_completed_idx on public.sales (listing_id) where completion_status = 'completed';
create index sales_seller_idx on public.sales (seller_id, completed_at desc);
create index sales_buyer_idx on public.sales (buyer_id, completed_at desc);

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null unique references public.sales (id) on delete restrict,
  seller_id uuid not null references public.profiles (id) on delete restrict,
  base_cents bigint not null check (base_cents >= 0),
  rate_bps int not null check (rate_bps between 0 and 5000),
  original_amount_cents bigint not null check (original_amount_cents >= 0),
  amount_cents bigint not null check (amount_cents >= 0),
  due_at timestamptz not null,
  status public.commission_status not null default 'awaiting_payment',
  reminder_sent_at timestamptz,
  paid_at timestamptz,
  verified_by uuid references public.profiles (id) on delete set null,
  admin_note text check (admin_note is null or char_length(admin_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index commissions_seller_idx on public.commissions (seller_id, created_at desc);
create index commissions_status_idx on public.commissions (status, due_at);

create table public.payment_reports (
  id uuid primary key default gen_random_uuid(),
  commission_id uuid not null references public.commissions (id) on delete cascade,
  reported_by uuid not null references public.profiles (id) on delete cascade,
  receipt_path text check (receipt_path is null or char_length(receipt_path) <= 300),
  note text check (note is null or char_length(note) <= 500),
  status public.payment_report_status not null default 'submitted',
  reviewed_by uuid references public.profiles (id) on delete set null,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  reviewed_at timestamptz,
  client_id uuid unique,
  created_at timestamptz not null default now()
);
create index payment_reports_commission_idx on public.payment_reports (commission_id, created_at desc);

-- ---------------------------------------------------------------- comunidade e operação
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('listing', 'user', 'conversation', 'sale')),
  target_id uuid not null,
  reason text not null check (reason in ('proibido', 'golpe', 'ofensivo', 'spam', 'informacao_falsa', 'contestacao', 'outro')),
  details text check (details is null or char_length(details) <= 1000),
  status public.report_status not null default 'open',
  resolved_by uuid references public.profiles (id) on delete set null,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 1000),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index reports_status_idx on public.reports (status, created_at desc);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  is_public boolean not null default true,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

-- ---------------------------------------------------------------- dados iniciais
insert into public.categories (id, name, icon, sort_order) values
  ('moveis', 'Móveis', 'sofa', 10),
  ('eletronicos', 'Eletrônicos', 'smartphone', 20),
  ('roupas', 'Roupas', 'shirt', 30),
  ('infantil', 'Infantil', 'baby', 40),
  ('casa', 'Casa', 'house', 50),
  ('eletrodomesticos', 'Eletrodomésticos', 'refrigerator', 60),
  ('esportes', 'Esportes', 'bike', 70),
  ('veiculos', 'Veículos', 'car', 80),
  ('livros', 'Livros', 'book-open', 90),
  ('outros', 'Outros', 'package', 100);

insert into public.app_settings (key, value, is_public) values
  ('app_name', '"Desapego da Família"', true),
  ('commission_rate_bps', '500', true),
  ('payment_due_days', '7', true),
  ('overdue_grace_days', '10', true),
  ('pix_key', '""', true),
  ('pix_receiver_name', '""', true),
  ('pix_city', '""', true),
  ('max_photos', '10', true),
  ('max_active_listings', '30', true),
  ('moderation_mode', '"post"', true),
  ('participation_policy', '"Anúncios são gratuitos. Quando você conclui uma venda, informa no app e paga a comissão combinada ao administrador por Pix, dentro do prazo. Doações e trocas sem dinheiro não pagam comissão."', true),
  ('access_code_hash', 'null', false);
