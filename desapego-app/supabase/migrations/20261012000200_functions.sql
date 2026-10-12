-- Desapego da Família — regras do servidor
-- Toda operação que mexe com dinheiro, status ou permissão passa por uma função aqui.
-- Funções "security definer" sempre conferem quem está chamando antes de agir.

-- ================================================================ utilidades internas (schema private)

create or replace function private.setting(p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select value from public.app_settings where key = p_key
$$;

create or replace function private.setting_int(p_key text, p_default int)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::int from public.app_settings where key = p_key), p_default)
$$;

create or replace function private.setting_text(p_key text)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select value #>> '{}' from public.app_settings where key = p_key), '')
$$;

create or replace function private.hash_code(p_code text)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'UTF8')), 'hex')
$$;

-- R$ 1.234,56 (somente para textos de aviso; cálculos usam centavos)
create or replace function private.brl(p_cents bigint)
returns text language sql immutable set search_path = '' as $$
  select 'R$ ' || replace(to_char(trunc(p_cents / 100), 'FM999,999,999,990'), ',', '.')
         || ',' || lpad((p_cents % 100)::text, 2, '0')
$$;

-- comissão = preço × taxa, arredondada ao centavo (meio centavo arredonda para cima)
create or replace function public.calc_commission_cents(p_price_cents bigint, p_rate_bps int)
returns bigint language sql immutable set search_path = '' as $$
  select case when p_price_cents <= 0 or p_rate_bps <= 0 then 0
              else (p_price_cents * p_rate_bps + 5000) / 10000 end
$$;

create or replace function private.notify(
  p_user uuid, p_type text, p_title text, p_body text, p_link text,
  p_dedupe text default null, p_payload jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null then return; end if;
  insert into public.notifications (user_id, type, title, body, link, payload, dedupe_key)
  values (p_user, p_type, p_title, p_body, p_link, coalesce(p_payload, '{}'::jsonb), p_dedupe)
  on conflict (user_id, dedupe_key) do update
    set type = excluded.type, title = excluded.title, body = excluded.body, link = excluded.link,
        payload = excluded.payload, created_at = now(), read_at = null;
end $$;

create or replace function private.notify_admins(
  p_type text, p_title text, p_body text, p_link text, p_dedupe text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from public.profiles where role = 'admin' and account_status = 'active' loop
    perform private.notify(r.id, p_type, p_title, p_body, p_link, p_dedupe);
  end loop;
end $$;

create or replace function private.audit(p_action text, p_type text, p_id text, p_meta jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (actor_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), p_action, p_type, p_id, coalesce(p_meta, '{}'::jsonb))
$$;

create or replace function private.system_message(p_conversation uuid, p_sender uuid, p_kind text, p_content text, p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_conversation is null then return; end if;
  insert into public.messages (conversation_id, sender_id, kind, content, metadata)
  values (p_conversation, p_sender, p_kind, p_content, coalesce(p_meta, '{}'::jsonb));
end $$;

-- ================================================================ perguntas de permissão (usadas pelas RLS)

create or replace function public.is_active_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and account_status = 'active')
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and account_status = 'active' and role = 'admin')
$$;

-- preparado para moderadores no futuro: hoje só administradores moderam
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and account_status = 'active' and role in ('admin', 'moderator'))
$$;

create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_blocks
                 where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a))
$$;

create or replace function private.require_member()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'Faça login para continuar.' using errcode = '42501'; end if;
  if not public.is_active_member() then raise exception 'Sua conta não está ativa.' using errcode = '42501'; end if;
  return v;
end $$;

create or replace function private.require_admin()
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Somente o administrador pode fazer isso.' using errcode = '42501'; end if;
  return auth.uid();
end $$;

-- membro com comissão em atraso, já avisado e fora do prazo de tolerância
create or replace function public.member_is_restricted(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.commissions c
    where c.seller_id = p_user and c.status = 'awaiting_payment'
      and c.due_at < now()
      and c.reminder_sent_at is not null
      and now() > c.reminder_sent_at + make_interval(days => private.setting_int('overdue_grace_days', 10))
  )
$$;

-- ================================================================ cadastro por convite

create or replace function public.check_invite(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_inv public.invites; v_access text;
begin
  if coalesce(btrim(p_code), '') = '' then return jsonb_build_object('valid', false); end if;
  select * into v_inv from public.invites
   where code_hash = private.hash_code(p_code) and revoked_at is null
     and expires_at > now() and use_count < max_uses;
  if found then
    return jsonb_build_object('valid', true, 'kind', 'invite', 'label', v_inv.label);
  end if;
  v_access := private.setting('access_code_hash') #>> '{}';
  if v_access is not null and v_access = private.hash_code(p_code) then
    return jsonb_build_object('valid', true, 'kind', 'access_code');
  end if;
  return jsonb_build_object('valid', false);
end $$;

-- roda dentro do cadastro do Supabase Auth: sem convite ou código válido, a conta não é criada
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_code text := v_meta ->> 'invite_code';
  v_name text := btrim(coalesce(v_meta ->> 'name', ''));
  v_inv public.invites;
  v_status public.account_status;
  v_role public.user_role := 'member';
  v_access text;
begin
  if coalesce(v_meta ->> 'accepted_terms', 'false') <> 'true' then
    raise exception 'É preciso aceitar os termos de utilização.';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'Informe seu nome.';
  end if;

  select * into v_inv from public.invites
   where code_hash = private.hash_code(v_code) and revoked_at is null
     and expires_at > now() and use_count < max_uses
   for update;

  if found then
    update public.invites set use_count = use_count + 1 where id = v_inv.id;
    v_status := 'active';
    v_role := v_inv.grants_role;
  else
    v_access := private.setting('access_code_hash') #>> '{}';
    if v_access is not null and v_access = private.hash_code(v_code) then
      v_status := 'pending';   -- código geral da família: o administrador aprova
    else
      raise exception 'Convite inválido ou expirado.';
    end if;
  end if;

  insert into public.profiles (id, name, role, account_status, terms_accepted_at, terms_version, invited_by)
  values (new.id, left(v_name, 60), v_role, v_status, now(), coalesce(v_meta ->> 'terms_version', '1'), v_inv.created_by);

  insert into public.profile_private (user_id, phone)
  values (new.id, nullif(left(btrim(coalesce(v_meta ->> 'phone', '')), 30), ''));

  if v_status = 'pending' then
    perform private.notify_admins('member_pending', 'Novo cadastro aguardando aprovação', v_name, '/admin/usuarios', 'pending:' || new.id);
  end if;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Usado UMA vez pelo dono, no SQL Editor do Supabase, para criar o próprio acesso de administrador.
-- Não fica disponível para o app (sem permissão de execução para anon/authenticated).
create or replace function public.create_owner_invite()
returns text language plpgsql security definer set search_path = '' as $$
declare v_code text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
begin
  insert into public.invites (code_hash, label, grants_role, expires_at, max_uses)
  values (private.hash_code(v_code), 'Administrador', 'admin', now() + interval '2 days', 1);
  return substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4);
end $$;

-- ================================================================ conta

create or replace function public.public_branding()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('app_name', private.setting_text('app_name'))
$$;

create or replace function public.update_my_private(p_phone text)
returns void language plpgsql security definer set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'Faça login.' using errcode = '42501'; end if;
  update public.profile_private set phone = nullif(left(btrim(coalesce(p_phone, '')), 30), ''), updated_at = now()
   where user_id = v;
end $$;

-- LGPD: anonimiza a conta. Vendas e comissões ficam guardadas pelo prazo legal, sem dados pessoais visíveis.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'Faça login.' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles where id = v and role = 'admin')
     and (select count(*) from public.profiles where role = 'admin' and account_status = 'active') <= 1 then
    raise exception 'Você é o único administrador. Defina outro administrador antes de excluir sua conta.';
  end if;
  update public.listings set status = 'deleted', updated_at = now()
   where seller_id = v and status not in ('sold', 'deleted');
  update public.offers set status = 'cancelled', responded_at = now()
   where (buyer_id = v or seller_id = v) and status = 'pending';
  update public.profile_private set phone = null, updated_at = now() where user_id = v;
  update public.profiles
     set name = 'Membro removido', avatar_url = null, location = null,
         contact_preferences = '{"whatsapp_in_chat": false}'::jsonb,
         account_status = 'deleted', updated_at = now()
   where id = v;
  delete from public.favorites where user_id = v;
  delete from public.notifications where user_id = v;
  perform private.audit('account.deleted_by_user', 'profile', v::text);
end $$;

-- ================================================================ anúncios

-- roda com o papel de quem chamou (security invoker), para distinguir app de funções do servidor
create or replace function private.listings_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_publishing boolean;
  v_max int;
begin
  -- funções do servidor (vendas, moderação) já fizeram suas próprias conferências
  if current_user not in ('authenticated', 'anon') then
    new.updated_at := now();
    return new;
  end if;

  if not public.is_active_member() then
    raise exception 'Sua conta não está ativa.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.seller_id := v_uid;
    new.published_at := null;
    new.sold_at := null;
    new.cover_path := null; new.cover_thumb_path := null; new.image_count := 0;
    if new.status not in ('draft', 'active', 'pending_review') then
      raise exception 'Status inicial inválido.';
    end if;
    if (select count(*) from public.listings where seller_id = v_uid and created_at > now() - interval '1 day') >= 20 then
      raise exception 'Limite de 20 anúncios novos por dia atingido. Tente amanhã.';
    end if;
    v_publishing := new.status <> 'draft';
  else
    if new.seller_id <> old.seller_id then raise exception 'Operação não permitida.' using errcode = '42501'; end if;
    if old.status in ('sold', 'deleted') then
      raise exception 'Este anúncio não pode mais ser alterado.';
    end if;
    if old.status = 'suspended' and new.status <> 'deleted' then
      raise exception 'Anúncio suspenso pela administração. Fale com o administrador.';
    end if;
    if new.status in ('sold', 'suspended') and new.status <> old.status then
      raise exception 'Use "Marcar como vendido" para concluir uma venda.';
    end if;
    if old.status = 'pending_review' and new.status not in ('pending_review', 'draft', 'deleted') then
      raise exception 'Este anúncio aguarda aprovação do administrador.';
    end if;
    if new.status = 'pending_review' and old.status not in ('draft', 'pending_review') then
      new.status := old.status;
    end if;
    v_publishing := old.status = 'draft' and new.status in ('active', 'pending_review');
    -- foto de capa e contagem são mantidas pelo servidor
    new.cover_path := old.cover_path; new.cover_thumb_path := old.cover_thumb_path; new.image_count := old.image_count;
    new.published_at := old.published_at; new.sold_at := old.sold_at; new.created_at := old.created_at;
  end if;

  if v_publishing then
    if public.member_is_restricted(v_uid) then
      raise exception 'Novos anúncios estão bloqueados até a regularização da comissão em atraso.';
    end if;
    v_max := private.setting_int('max_active_listings', 30);
    if (select count(*) from public.listings
         where seller_id = v_uid and status in ('active', 'reserved', 'paused', 'pending_review') and id <> new.id) >= v_max then
      raise exception 'Você atingiu o limite de % anúncios ativos.', v_max;
    end if;
    if private.setting_text('moderation_mode') = 'pre' and not public.is_admin() then
      new.status := 'pending_review';
    else
      new.status := 'active';
      new.published_at := now();
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status = 'active' and new.published_at is null then
    new.published_at := now();
  end if;

  if new.listing_type = 'doacao' then
    new.asking_price_cents := 0;
    new.accepts_offers := false;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger listings_guard
  before insert or update on public.listings
  for each row execute function private.listings_guard();

-- quando o anúncio sai de circulação, propostas em aberto deixam de valer
create or replace function private.listings_after_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('deleted', 'suspended', 'sold') and new.status <> old.status then
    update public.offers set status = 'cancelled', responded_at = now()
     where listing_id = new.id and status = 'pending';
  end if;
  return null;
end $$;

create trigger listings_after_status
  after update of status on public.listings
  for each row execute function private.listings_after_status();

-- roda com o papel de quem chamou (security invoker), para distinguir app de funções do servidor
create or replace function private.listing_images_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_listing public.listings; v_max int := private.setting_int('max_photos', 10);
begin
  select * into v_listing from public.listings where id = coalesce(new.listing_id, old.listing_id);
  if current_user in ('authenticated', 'anon') then
    if v_listing.seller_id is distinct from auth.uid() then
      raise exception 'Operação não permitida.' using errcode = '42501';
    end if;
    if v_listing.status in ('sold', 'deleted', 'suspended') then
      raise exception 'Este anúncio não pode mais ser alterado.';
    end if;
    if tg_op = 'INSERT' then
      if new.storage_path not like auth.uid()::text || '/%' or new.thumb_path not like auth.uid()::text || '/%' then
        raise exception 'Caminho de imagem inválido.' using errcode = '42501';
      end if;
      if (select count(*) from public.listing_images where listing_id = new.listing_id) >= v_max then
        raise exception 'Máximo de % fotos por anúncio.', v_max;
      end if;
    end if;
    if tg_op = 'UPDATE' and (new.listing_id <> old.listing_id or new.storage_path <> old.storage_path or new.thumb_path <> old.thumb_path) then
      raise exception 'Operação não permitida.' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger listing_images_guard
  before insert or update or delete on public.listing_images
  for each row execute function private.listing_images_guard();

create or replace function private.listing_images_sync_cover()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(new.listing_id, old.listing_id);
begin
  update public.listings l set
    cover_path = c.storage_path, cover_thumb_path = c.thumb_path,
    image_count = (select count(*) from public.listing_images where listing_id = v_id)
  from (select 1) d
  left join lateral (
    select storage_path, thumb_path from public.listing_images
     where listing_id = v_id order by display_order, created_at limit 1
  ) c on true
  where l.id = v_id;
  return null;
end $$;

create trigger listing_images_sync_cover
  after insert or update or delete on public.listing_images
  for each row execute function private.listing_images_sync_cover();

-- minúsculas e sem acento, para a busca achar "televisao" em "Televisão"
create or replace function public.fold_text(p text)
returns text language sql immutable set search_path = '' as $$
  select translate(lower(coalesce(p, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')
$$;

-- vitrine e busca; respeita as RLS de quem consulta
create or replace function public.search_listings(
  p_query text default null,
  p_category text default null,
  p_min_cents bigint default null,
  p_max_cents bigint default null,
  p_conditions public.listing_condition[] default null,
  p_location text default null,
  p_accepts_offers boolean default null,
  p_accepts_trade boolean default null,
  p_donation boolean default null,
  p_since_days int default null,
  p_include_reserved boolean default true,
  p_seller uuid default null,
  p_exclude uuid default null,
  p_sort text default 'recent',
  p_limit int default 24,
  p_offset int default 0)
returns table (
  id uuid, title text, asking_price_cents bigint, condition public.listing_condition,
  listing_type public.listing_type, accepts_offers boolean, accepts_trade boolean,
  location text, status public.listing_status, category_id text,
  cover_path text, cover_thumb_path text, published_at timestamptz, created_at timestamptz,
  seller_id uuid, seller_name text, rank real)
language sql stable security invoker set search_path = '' as $$
  with q as (
    select nullif(btrim(coalesce(p_query, '')), '') as txt,
           case when nullif(btrim(coalesce(p_query, '')), '') is null then null
                else websearch_to_tsquery('portuguese', p_query) end as tsq
  )
  select l.id, l.title, l.asking_price_cents, l.condition, l.listing_type, l.accepts_offers, l.accepts_trade,
         l.location, l.status, l.category_id, l.cover_path, l.cover_thumb_path, l.published_at, l.created_at,
         l.seller_id, p.name,
         case when q.tsq is null then 0::real else ts_rank(l.search, q.tsq) + (case when strpos(public.fold_text(l.title), public.fold_text(q.txt)) > 0 then 1 else 0 end)::real end
  from public.listings l
  join public.profiles p on p.id = l.seller_id
  cross join q
  where (l.status = 'active' or (coalesce(p_include_reserved, true) and l.status = 'reserved'))
    and (q.txt is null or l.search @@ q.tsq
         -- cada palavra digitada aparece no título, descrição ou local (aceita parte da palavra)
         or not exists (select 1 from unnest(string_to_array(public.fold_text(q.txt), ' ')) w
                        where w <> '' and strpos(public.fold_text(l.title || ' ' || l.description || ' ' || coalesce(l.location, '')), w) = 0))
    and (p_category is null or l.category_id = p_category)
    and (p_min_cents is null or l.asking_price_cents >= p_min_cents)
    and (p_max_cents is null or l.asking_price_cents <= p_max_cents)
    and (p_conditions is null or cardinality(p_conditions) = 0 or l.condition = any (p_conditions))
    and (nullif(btrim(coalesce(p_location, '')), '') is null or strpos(public.fold_text(l.location), public.fold_text(btrim(p_location))) > 0)
    and (p_accepts_offers is null or l.accepts_offers = p_accepts_offers)
    and (p_accepts_trade is null or l.accepts_trade = p_accepts_trade)
    and (p_donation is null or (l.listing_type = 'doacao') = p_donation)
    and (p_since_days is null or coalesce(l.published_at, l.created_at) > now() - make_interval(days => p_since_days))
    and (p_seller is null or l.seller_id = p_seller)
    and (p_exclude is null or l.id <> p_exclude)
  order by
    case when l.status = 'active' then 0 else 1 end,
    case when p_sort = 'price_asc' then l.asking_price_cents end asc nulls last,
    case when p_sort = 'price_desc' then l.asking_price_cents end desc nulls last,
    case when p_sort = 'relevance' and q.tsq is not null
         then ts_rank(l.search, q.tsq) + (case when strpos(public.fold_text(l.title), public.fold_text(q.txt)) > 0 then 1 else 0 end) end desc nulls last,
    coalesce(l.published_at, l.created_at) desc
  limit least(greatest(coalesce(p_limit, 24), 1), 60)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- ================================================================ conversas

create or replace function public.start_conversation(p_listing uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_member(); v_l public.listings; v_id uuid;
begin
  select * into v_l from public.listings where id = p_listing;
  if not found or v_l.status not in ('active', 'reserved', 'paused', 'sold') then
    raise exception 'Anúncio indisponível.';
  end if;
  if v_l.seller_id = v_uid then raise exception 'Este anúncio é seu.'; end if;
  select id into v_id from public.conversations where listing_id = p_listing and buyer_id = v_uid;
  if v_id is not null then return v_id; end if;
  if v_l.status not in ('active', 'reserved') then raise exception 'Anúncio indisponível.'; end if;
  if public.is_blocked_between(v_uid, v_l.seller_id) then
    raise exception 'Não é possível conversar com este membro.';
  end if;
  insert into public.conversations (listing_id, buyer_id, seller_id)
  values (p_listing, v_uid, v_l.seller_id)
  on conflict (listing_id, buyer_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.conversations where listing_id = p_listing and buyer_id = v_uid;
  end if;
  return v_id;
end $$;

-- roda com o papel de quem chamou (security invoker), para distinguir app de funções do servidor
create or replace function private.messages_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_c public.conversations; v_listing_status public.listing_status;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  select * into v_c from public.conversations where id = new.conversation_id;
  if not found or auth.uid() not in (v_c.buyer_id, v_c.seller_id) then
    raise exception 'Conversa não encontrada.' using errcode = '42501';
  end if;
  new.sender_id := auth.uid();
  new.kind := 'text';
  new.metadata := '{}'::jsonb;
  new.read_at := null;
  new.created_at := now();
  if not public.is_active_member() then raise exception 'Sua conta não está ativa.' using errcode = '42501'; end if;
  if public.is_blocked_between(v_c.buyer_id, v_c.seller_id) then
    raise exception 'Não é possível enviar mensagens nesta conversa.';
  end if;
  select status into v_listing_status from public.listings where id = v_c.listing_id;
  if v_listing_status is null or v_listing_status in ('deleted', 'suspended') then
    raise exception 'Este anúncio foi encerrado.';
  end if;
  if (select count(*) from public.messages where sender_id = auth.uid() and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Muitas mensagens em pouco tempo. Aguarde um instante.';
  end if;
  return new;
end $$;

create trigger messages_guard
  before insert on public.messages
  for each row execute function private.messages_guard();

create or replace function private.messages_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_c public.conversations; v_to uuid; v_title text; v_sender text;
begin
  select * into v_c from public.conversations where id = new.conversation_id;
  update public.conversations
     set last_message_at = new.created_at, last_message_preview = left(new.content, 120)
   where id = new.conversation_id;
  if new.kind = 'system' then return null; end if;
  v_to := case when new.sender_id = v_c.buyer_id then v_c.seller_id else v_c.buyer_id end;
  select title into v_title from public.listings where id = v_c.listing_id;
  select name into v_sender from public.profiles where id = new.sender_id;
  if new.kind in ('text', 'whatsapp') then
    -- uma notificação por conversa, atualizada a cada mensagem (sem duplicar)
    perform private.notify(v_to, 'message', v_sender || ' · ' || v_title, left(new.content, 140),
                           '/conversas/' || new.conversation_id, 'conv:' || new.conversation_id);
  end if;
  return null;
end $$;

create trigger messages_after_insert
  after insert on public.messages
  for each row execute function private.messages_after_insert();

create or replace function public.mark_conversation_read(p_conversation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.conversations where id = p_conversation and v_uid in (buyer_id, seller_id)) then
    raise exception 'Conversa não encontrada.' using errcode = '42501';
  end if;
  update public.messages set read_at = now()
   where conversation_id = p_conversation and sender_id <> v_uid and read_at is null;
  update public.notifications set read_at = now()
   where user_id = v_uid and dedupe_key = 'conv:' || p_conversation and read_at is null;
end $$;

-- o vendedor escolhe mostrar o WhatsApp para quem está conversando com ele
create or replace function public.share_whatsapp(p_conversation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_member(); v_c public.conversations; v_phone text;
begin
  select * into v_c from public.conversations where id = p_conversation;
  if not found or v_uid not in (v_c.buyer_id, v_c.seller_id) then
    raise exception 'Conversa não encontrada.' using errcode = '42501';
  end if;
  if public.is_blocked_between(v_c.buyer_id, v_c.seller_id) then raise exception 'Conversa bloqueada.'; end if;
  select phone into v_phone from public.profile_private where user_id = v_uid;
  if coalesce(v_phone, '') = '' then
    raise exception 'Cadastre seu telefone no perfil para compartilhar o WhatsApp.';
  end if;
  insert into public.messages (conversation_id, sender_id, kind, content, metadata)
  values (p_conversation, v_uid, 'whatsapp', 'Pode me chamar no WhatsApp: ' || v_phone,
          jsonb_build_object('phone', regexp_replace(v_phone, '\D', '', 'g')));
end $$;

create or replace function public.my_conversations()
returns table (
  id uuid, listing_id uuid, listing_title text, listing_price_cents bigint, listing_status public.listing_status,
  listing_thumb text, i_am_seller boolean, other_id uuid, other_name text, other_avatar text,
  last_message_at timestamptz, last_message_preview text, unread bigint)
language sql stable security invoker set search_path = '' as $$
  select c.id, l.id, l.title, l.asking_price_cents, l.status, l.cover_thumb_path,
         c.seller_id = auth.uid(), o.id, o.name, o.avatar_url,
         c.last_message_at, c.last_message_preview,
         (select count(*) from public.messages m
           where m.conversation_id = c.id and m.sender_id <> auth.uid() and m.read_at is null)
  from public.conversations c
  join public.listings l on l.id = c.listing_id
  join public.profiles o on o.id = case when c.seller_id = auth.uid() then c.buyer_id else c.seller_id end
  where auth.uid() in (c.buyer_id, c.seller_id)
  order by c.last_message_at desc
  limit 200
$$;

create or replace function public.unread_counts()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'messages', (select count(*) from public.messages m join public.conversations c on c.id = m.conversation_id
                  where auth.uid() in (c.buyer_id, c.seller_id) and m.sender_id <> auth.uid() and m.read_at is null),
    'notifications', (select count(*) from public.notifications where user_id = auth.uid() and read_at is null))
$$;

-- ================================================================ propostas

create or replace function public.make_offer(p_listing uuid, p_amount_cents bigint, p_client_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_member(); v_l public.listings; v_conv uuid; v_id uuid; v_name text;
begin
  if p_client_id is not null then
    select id into v_id from public.offers where client_id = p_client_id;
    if v_id is not null then return v_id; end if;   -- toque duplo / reenvio: mesma proposta
  end if;
  select * into v_l from public.listings where id = p_listing for update;
  if not found or v_l.status <> 'active' then
    raise exception 'Este anúncio não está recebendo propostas.';
  end if;
  if v_l.seller_id = v_uid then raise exception 'Você não pode fazer proposta no seu próprio anúncio.'; end if;
  if v_l.listing_type <> 'venda' or not v_l.accepts_offers then
    raise exception 'Este anúncio não aceita propostas.';
  end if;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 100000000000 then
    raise exception 'Valor de proposta inválido.';
  end if;
  if public.is_blocked_between(v_uid, v_l.seller_id) then raise exception 'Não é possível negociar com este membro.'; end if;
  if (select count(*) from public.offers where proposed_by = v_uid and created_at > now() - interval '1 hour') >= 15 then
    raise exception 'Muitas propostas em pouco tempo. Aguarde um pouco.';
  end if;

  -- a nova proposta substitui qualquer outra em aberto entre os dois neste anúncio
  update public.offers
     set status = case when proposed_by = v_uid then 'cancelled'::public.offer_status else 'countered'::public.offer_status end,
         responded_at = now()
   where listing_id = p_listing and buyer_id = v_uid and status = 'pending';

  v_conv := public.start_conversation(p_listing);
  insert into public.offers (listing_id, conversation_id, buyer_id, seller_id, proposed_by, amount_cents, client_id)
  values (p_listing, v_conv, v_uid, v_l.seller_id, v_uid, p_amount_cents, p_client_id)
  returning id into v_id;

  select name into v_name from public.profiles where id = v_uid;
  perform private.system_message(v_conv, v_uid, 'offer', 'Proposta: ' || private.brl(p_amount_cents),
                                 jsonb_build_object('offer_id', v_id, 'amount_cents', p_amount_cents));
  perform private.notify(v_l.seller_id, 'offer_new', 'Nova proposta: ' || private.brl(p_amount_cents),
                         v_name || ' · ' || v_l.title, '/conversas/' || v_conv, 'offer:' || v_id);
  return v_id;
end $$;

create or replace function public.respond_offer(p_offer uuid, p_action text, p_counter_cents bigint default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_member(); v_o public.offers; v_l public.listings; v_to uuid; v_new uuid; v_txt text;
begin
  select * into v_o from public.offers where id = p_offer;
  if not found or v_uid not in (v_o.buyer_id, v_o.seller_id) then
    raise exception 'Proposta não encontrada.' using errcode = '42501';
  end if;
  select * into v_l from public.listings where id = v_o.listing_id for update;
  select * into v_o from public.offers where id = p_offer for update;   -- relê com trava
  if v_o.status <> 'pending' then raise exception 'Esta proposta já foi respondida.'; end if;
  if v_o.proposed_by = v_uid then raise exception 'Aguarde a resposta da outra pessoa.'; end if;
  if v_l.status not in ('active', 'reserved') then raise exception 'Este anúncio não está mais disponível.'; end if;
  v_to := v_o.proposed_by;

  if p_action = 'accept' then
    update public.offers set status = 'accepted', responded_at = now() where id = p_offer;
    v_txt := 'Proposta de ' || private.brl(v_o.amount_cents) || ' aceita. Combinem retirada e pagamento.';
    perform private.system_message(v_o.conversation_id, v_uid, 'system', v_txt, jsonb_build_object('offer_id', p_offer, 'event', 'accepted'));
    perform private.notify(v_to, 'offer_accepted', 'Proposta aceita!', v_l.title || ' · ' || private.brl(v_o.amount_cents),
                           '/conversas/' || v_o.conversation_id, 'offer:' || p_offer);
    return p_offer;
  elsif p_action = 'reject' then
    update public.offers set status = 'rejected', responded_at = now() where id = p_offer;
    perform private.system_message(v_o.conversation_id, v_uid, 'system', 'Proposta de ' || private.brl(v_o.amount_cents) || ' recusada.',
                                   jsonb_build_object('offer_id', p_offer, 'event', 'rejected'));
    perform private.notify(v_to, 'offer_rejected', 'Proposta recusada', v_l.title,
                           '/conversas/' || v_o.conversation_id, 'offer:' || p_offer);
    return p_offer;
  elsif p_action = 'counter' then
    if p_counter_cents is null or p_counter_cents < 1 or p_counter_cents > 100000000000 then
      raise exception 'Valor de contraproposta inválido.';
    end if;
    if v_l.status <> 'active' then raise exception 'Este anúncio não está recebendo propostas.'; end if;
    update public.offers set status = 'countered', responded_at = now() where id = p_offer;
    insert into public.offers (listing_id, conversation_id, buyer_id, seller_id, proposed_by, amount_cents, parent_offer_id)
    values (v_o.listing_id, v_o.conversation_id, v_o.buyer_id, v_o.seller_id, v_uid, p_counter_cents, p_offer)
    returning id into v_new;
    perform private.system_message(v_o.conversation_id, v_uid, 'offer', 'Contraproposta: ' || private.brl(p_counter_cents),
                                   jsonb_build_object('offer_id', v_new, 'amount_cents', p_counter_cents, 'counter', true));
    perform private.notify(v_to, 'offer_counter', 'Contraproposta: ' || private.brl(p_counter_cents), v_l.title,
                           '/conversas/' || v_o.conversation_id, 'offer:' || v_new);
    return v_new;
  else
    raise exception 'Ação inválida.';
  end if;
end $$;

create or replace function public.cancel_offer(p_offer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_o public.offers;
begin
  select * into v_o from public.offers where id = p_offer for update;
  if not found or v_o.proposed_by is distinct from v_uid then
    raise exception 'Proposta não encontrada.' using errcode = '42501';
  end if;
  if v_o.status not in ('pending', 'accepted') then raise exception 'Esta proposta não pode mais ser cancelada.'; end if;
  update public.offers set status = 'cancelled', responded_at = now() where id = p_offer;
  perform private.system_message(v_o.conversation_id, v_uid, 'system', 'Proposta de ' || private.brl(v_o.amount_cents) || ' cancelada.',
                                 jsonb_build_object('offer_id', p_offer, 'event', 'cancelled'));
end $$;

-- ================================================================ vendas e comissões

-- O vendedor declara a venda. O app não tem como saber de vendas combinadas fora dele:
-- tudo aqui é declaração do vendedor, com confirmação opcional do comprador.
create or replace function public.mark_listing_sold(
  p_listing uuid,
  p_final_price_cents bigint,
  p_sale_type public.sale_type default 'venda',
  p_buyer uuid default null,
  p_buyer_external_name text default null,
  p_offer uuid default null,
  p_client_request_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_member();
  v_l public.listings; v_o public.offers;
  v_type public.sale_type := coalesce(p_sale_type, 'venda');
  v_price bigint := coalesce(p_final_price_cents, 0);
  v_rate int; v_comm bigint; v_sale uuid; v_conv uuid; v_due timestamptz;
begin
  if p_client_request_id is not null then
    select id into v_sale from public.sales where client_request_id = p_client_request_id;
    if v_sale is not null then return v_sale; end if;   -- envio repetido: não duplica a venda
  end if;

  select * into v_l from public.listings where id = p_listing for update;
  if not found or v_l.seller_id <> v_uid then
    raise exception 'Anúncio não encontrado.' using errcode = '42501';
  end if;
  if v_l.status not in ('active', 'paused', 'reserved') then
    raise exception 'Este anúncio não pode ser marcado como vendido (situação atual: %).', v_l.status;
  end if;

  if v_l.listing_type = 'doacao' then v_type := 'doacao'; end if;
  if v_type = 'doacao' then v_price := 0; end if;
  if v_type = 'venda' and (v_price < 1 or v_price > 100000000000) then
    raise exception 'Informe o valor real da venda.';
  end if;
  if v_type = 'troca' and (v_price < 0 or v_price > 100000000000) then
    raise exception 'Valor inválido.';
  end if;

  if p_buyer is not null then
    if p_buyer = v_uid then raise exception 'Comprador inválido.'; end if;
    if not exists (select 1 from public.profiles where id = p_buyer and account_status in ('active', 'suspended')) then
      raise exception 'Comprador não encontrado.';
    end if;
  end if;

  if p_offer is not null then
    select * into v_o from public.offers where id = p_offer;
    if not found or v_o.listing_id <> p_listing or v_o.status <> 'accepted' then
      raise exception 'Proposta inválida para esta venda.';
    end if;
    if p_buyer is not null and p_buyer <> v_o.buyer_id then raise exception 'Proposta de outro comprador.'; end if;
    p_buyer := v_o.buyer_id;
  end if;

  -- taxa congelada no momento da venda: mudanças futuras não afetam esta venda
  v_rate := private.setting_int('commission_rate_bps', 500);
  v_comm := case when v_type = 'venda' then public.calc_commission_cents(v_price, v_rate) else 0 end;

  insert into public.sales (listing_id, seller_id, buyer_id, buyer_external_name, offer_id, sale_type,
                            final_price_cents, commission_rate_snapshot, commission_cents,
                            buyer_confirmation, client_request_id)
  values (p_listing, v_uid, p_buyer, nullif(left(btrim(coalesce(p_buyer_external_name, '')), 80), ''), p_offer, v_type,
          v_price, v_rate, v_comm,
          case when p_buyer is null then 'not_applicable'::public.buyer_confirmation else 'pending'::public.buyer_confirmation end,
          p_client_request_id)
  returning id into v_sale;

  update public.listings set status = 'sold', sold_at = now(), updated_at = now() where id = p_listing;

  if v_comm > 0 then
    v_due := now() + make_interval(days => private.setting_int('payment_due_days', 7));
    insert into public.commissions (sale_id, seller_id, base_cents, rate_bps, original_amount_cents, amount_cents, due_at)
    values (v_sale, v_uid, v_price, v_rate, v_comm, v_comm, v_due);
    perform private.notify(v_uid, 'commission_new', 'Comissão gerada: ' || private.brl(v_comm),
                           v_l.title || ' · pagar até ' || to_char(v_due at time zone 'America/Sao_Paulo', 'DD/MM'),
                           '/perfil/comissoes', 'commission:' || v_sale);
  end if;

  if p_buyer is not null then
    select id into v_conv from public.conversations where listing_id = p_listing and buyer_id = p_buyer;
    perform private.system_message(v_conv, v_uid, 'sale', 'Venda registrada por ' || private.brl(v_price) || '. Confirme no app se está tudo certo.',
                                   jsonb_build_object('sale_id', v_sale));
    perform private.notify(p_buyer, 'sale_confirm', 'Confirme sua compra', v_l.title || ' · ' || private.brl(v_price),
                           '/perfil/compras', 'sale:' || v_sale);
  end if;
  return v_sale;
end $$;

create or replace function public.confirm_purchase(p_sale uuid, p_confirmed boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_member(); v_s public.sales; v_title text;
begin
  select * into v_s from public.sales where id = p_sale for update;
  if not found or v_s.buyer_id is distinct from v_uid then
    raise exception 'Venda não encontrada.' using errcode = '42501';
  end if;
  if v_s.completion_status <> 'completed' or v_s.buyer_confirmation <> 'pending' then
    raise exception 'Esta venda já foi respondida.';
  end if;
  update public.sales
     set buyer_confirmation = case when p_confirmed then 'confirmed'::public.buyer_confirmation else 'disputed'::public.buyer_confirmation end,
         buyer_confirmed_at = now(), buyer_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where id = p_sale;
  select title into v_title from public.listings where id = v_s.listing_id;
  if not p_confirmed then
    insert into public.reports (reporter_id, target_type, target_id, reason, details)
    values (v_uid, 'sale', p_sale, 'contestacao', nullif(left(btrim(coalesce(p_note, '')), 1000), ''));
    perform private.notify_admins('sale_disputed', 'Compra contestada', v_title, '/admin/denuncias', 'dispute:' || p_sale);
  end if;
  perform private.notify(v_s.seller_id, 'sale_buyer_' || case when p_confirmed then 'confirmed' else 'disputed' end,
                         case when p_confirmed then 'Comprador confirmou a compra' else 'Comprador contestou a venda' end,
                         v_title, '/perfil/vendas', 'salebuyer:' || p_sale);
end $$;

-- cancela uma venda registrada. O vendedor só pode antes de pagar a comissão; o administrador sempre.
create or replace function public.cancel_sale(p_sale uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_member(); v_admin boolean := public.is_admin();
  v_s public.sales; v_c public.commissions; v_title text;
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Informe o motivo do cancelamento.'; end if;
  select * into v_s from public.sales where id = p_sale for update;
  if not found or (v_s.seller_id <> v_uid and not v_admin) then
    raise exception 'Venda não encontrada.' using errcode = '42501';
  end if;
  if v_s.completion_status <> 'completed' then raise exception 'Esta venda já foi cancelada.'; end if;
  select * into v_c from public.commissions where sale_id = p_sale for update;
  if found and not v_admin and v_c.status <> 'awaiting_payment' then
    raise exception 'A comissão já está em pagamento ou conferência. Peça o cancelamento ao administrador.';
  end if;

  update public.sales set completion_status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid,
                          cancel_reason = left(btrim(p_reason), 500)
   where id = p_sale;
  if v_c.id is not null then
    update public.commissions
       set status = case when v_c.status = 'paid' then 'refunded'::public.commission_status else 'cancelled'::public.commission_status end,
           admin_note = coalesce(admin_note || ' | ', '') || 'Venda cancelada: ' || left(btrim(p_reason), 300),
           updated_at = now()
     where id = v_c.id and status not in ('cancelled', 'refunded', 'waived');
  end if;
  update public.listings set status = 'active', sold_at = null, updated_at = now()
   where id = v_s.listing_id and status = 'sold';

  select title into v_title from public.listings where id = v_s.listing_id;
  perform private.audit('sale.cancelled', 'sale', p_sale::text,
                        jsonb_build_object('reason', p_reason, 'by_admin', v_admin, 'commission_status_before', v_c.status));
  if not v_admin then
    perform private.notify_admins('sale_cancelled', 'Venda cancelada pelo vendedor', v_title || ' · ' || left(p_reason, 100),
                                  '/admin/comissoes', 'salecancel:' || p_sale);
  else
    perform private.notify(v_s.seller_id, 'sale_cancelled', 'Venda cancelada pelo administrador', v_title, '/perfil/vendas', 'salecancel:' || p_sale);
  end if;
  if v_s.buyer_id is not null then
    perform private.notify(v_s.buyer_id, 'sale_cancelled', 'Venda cancelada', v_title, '/perfil/compras', 'salecancel:' || p_sale);
  end if;
end $$;

-- visão com a situação "em atraso" calculada na hora (sem tarefa agendada)
create view public.commissions_view with (security_invoker = true) as
  select c.*,
         case when c.status = 'awaiting_payment' and c.due_at < now() then 'overdue' else c.status::text end as effective_status,
         s.listing_id, s.final_price_cents, s.sale_type, s.completed_at, s.buyer_id,
         l.title as listing_title, l.cover_thumb_path as listing_thumb,
         p.name as seller_name
  from public.commissions c
  join public.sales s on s.id = c.sale_id
  join public.listings l on l.id = s.listing_id
  join public.profiles p on p.id = c.seller_id;

-- envia lembrete das comissões vencidas do próprio membro (chamado ao abrir o app; nada de cron)
create or replace function public.sync_my_reminders()
returns int language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); r record; n int := 0;
begin
  if v_uid is null then return 0; end if;
  for r in
    select c.id, c.amount_cents, l.title, c.due_at from public.commissions c
    join public.sales s on s.id = c.sale_id join public.listings l on l.id = s.listing_id
    where c.seller_id = v_uid and c.status = 'awaiting_payment' and c.due_at < now() and c.reminder_sent_at is null
  loop
    update public.commissions set reminder_sent_at = now() where id = r.id;
    perform private.notify(v_uid, 'commission_reminder', 'Comissão vencida: ' || private.brl(r.amount_cents),
      r.title || '. Após ' || private.setting_int('overdue_grace_days', 10) || ' dias deste aviso, novos anúncios ficam bloqueados até a regularização.',
      '/perfil/comissoes', 'reminder:' || r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.report_payment(p_commission uuid, p_receipt_path text default null, p_note text default null, p_client_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_member(); v_c public.commissions; v_id uuid; v_seller text;
begin
  if p_client_id is not null then
    select id into v_id from public.payment_reports where client_id = p_client_id;
    if v_id is not null then return v_id; end if;
  end if;
  select * into v_c from public.commissions where id = p_commission for update;
  if not found or v_c.seller_id <> v_uid then
    raise exception 'Comissão não encontrada.' using errcode = '42501';
  end if;
  if v_c.status <> 'awaiting_payment' then
    raise exception 'Esta comissão não está aguardando pagamento.';
  end if;
  if p_receipt_path is not null and p_receipt_path not like v_uid::text || '/%' then
    raise exception 'Comprovante inválido.' using errcode = '42501';
  end if;
  insert into public.payment_reports (commission_id, reported_by, receipt_path, note, client_id)
  values (p_commission, v_uid, p_receipt_path, nullif(left(btrim(coalesce(p_note, '')), 500), ''), p_client_id)
  returning id into v_id;
  -- só o administrador confirma recebimento: aqui fica apenas "pagamento informado"
  update public.commissions set status = 'payment_reported', updated_at = now() where id = p_commission;
  select name into v_seller from public.profiles where id = v_uid;
  perform private.notify_admins('payment_reported', 'Pagamento informado: ' || private.brl(v_c.amount_cents), v_seller,
                                '/admin/comissoes', 'payrep:' || p_commission);
  return v_id;
end $$;

-- ================================================================ administração

create or replace function public.admin_commission_action(p_commission uuid, p_action text, p_reason text default null, p_amount_cents bigint default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := private.require_admin(); v_c public.commissions; v_new public.commission_status; v_title text;
begin
  select * into v_c from public.commissions where id = p_commission for update;
  if not found then raise exception 'Comissão não encontrada.'; end if;

  if p_action = 'start_review' then
    if v_c.status <> 'payment_reported' then raise exception 'Não há pagamento informado para conferir.'; end if;
    v_new := 'under_review';
  elsif p_action = 'confirm_paid' then
    if v_c.status not in ('awaiting_payment', 'payment_reported', 'under_review') then
      raise exception 'Situação atual não permite confirmar recebimento.';
    end if;
    v_new := 'paid';
    update public.payment_reports set status = 'accepted', reviewed_by = v_admin, reviewed_at = now()
     where commission_id = p_commission and status = 'submitted';
  elsif p_action = 'reject_report' then
    if v_c.status not in ('payment_reported', 'under_review') then raise exception 'Não há pagamento informado.'; end if;
    if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Explique o motivo para o vendedor.'; end if;
    v_new := 'awaiting_payment';
    update public.payment_reports set status = 'rejected', reviewed_by = v_admin, reviewed_at = now(), review_note = left(p_reason, 500)
     where commission_id = p_commission and status = 'submitted';
  elsif p_action in ('waive', 'cancel', 'refund', 'adjust') then
    if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Informe a justificativa.'; end if;
    if p_action = 'waive' then
      if v_c.status in ('paid', 'refunded', 'cancelled') then raise exception 'Situação atual não permite isenção.'; end if;
      v_new := 'waived';
    elsif p_action = 'cancel' then
      if v_c.status in ('paid', 'refunded') then raise exception 'Comissão paga: use estorno.'; end if;
      v_new := 'cancelled';
    elsif p_action = 'refund' then
      if v_c.status <> 'paid' then raise exception 'Só é possível estornar comissão paga.'; end if;
      v_new := 'refunded';
    else
      if v_c.status not in ('awaiting_payment', 'payment_reported', 'under_review') then
        raise exception 'Só é possível ajustar comissão ainda não paga.';
      end if;
      if p_amount_cents is null or p_amount_cents < 0 or p_amount_cents > v_c.base_cents then
        raise exception 'Valor de ajuste inválido.';
      end if;
      v_new := case when p_amount_cents = 0 then 'waived'::public.commission_status else v_c.status end;
      update public.commissions set amount_cents = p_amount_cents where id = p_commission;
    end if;
  else
    raise exception 'Ação inválida.';
  end if;

  update public.commissions set
    status = v_new,
    paid_at = case when v_new = 'paid' then now() else paid_at end,
    verified_by = case when v_new = 'paid' then v_admin else verified_by end,
    admin_note = case when p_reason is not null and btrim(p_reason) <> '' then coalesce(admin_note || ' | ', '') || left(btrim(p_reason), 300) else admin_note end,
    updated_at = now()
  where id = p_commission;

  perform private.audit('commission.' || p_action, 'commission', p_commission::text,
    jsonb_build_object('from', v_c.status, 'to', v_new, 'reason', p_reason,
                       'amount_before', v_c.amount_cents, 'amount_after', coalesce(p_amount_cents, v_c.amount_cents)));

  select l.title into v_title from public.sales s join public.listings l on l.id = s.listing_id where s.id = v_c.sale_id;
  if p_action = 'confirm_paid' then
    perform private.notify(v_c.seller_id, 'payment_approved', 'Pagamento confirmado', v_title || ' · ' || private.brl(v_c.amount_cents), '/perfil/comissoes', 'commission:' || v_c.sale_id);
  elsif p_action = 'reject_report' then
    perform private.notify(v_c.seller_id, 'payment_rejected', 'Pagamento não localizado', coalesce(p_reason, ''), '/perfil/comissoes', 'commission:' || v_c.sale_id);
  elsif p_action in ('waive', 'adjust', 'cancel', 'refund') then
    perform private.notify(v_c.seller_id, 'commission_changed', 'Comissão atualizada pelo administrador', v_title || ' · ' || coalesce(p_reason, ''), '/perfil/comissoes', 'commission:' || v_c.sale_id);
  end if;
end $$;

create or replace function public.admin_send_reminder(p_commission uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := private.require_admin(); v_c public.commissions; v_title text;
begin
  select * into v_c from public.commissions where id = p_commission for update;
  if not found or v_c.status <> 'awaiting_payment' then raise exception 'Comissão não está aguardando pagamento.'; end if;
  select l.title into v_title from public.sales s join public.listings l on l.id = s.listing_id where s.id = v_c.sale_id;
  update public.commissions set reminder_sent_at = coalesce(reminder_sent_at, now()), updated_at = now() where id = p_commission;
  perform private.notify(v_c.seller_id, 'commission_reminder', 'Lembrete de comissão: ' || private.brl(v_c.amount_cents),
                         v_title || ' · vencimento ' || to_char(v_c.due_at at time zone 'America/Sao_Paulo', 'DD/MM'),
                         '/perfil/comissoes', 'reminder:' || p_commission);
  perform private.audit('commission.reminder', 'commission', p_commission::text);
end $$;

create or replace function public.admin_dashboard()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform private.require_admin();
  select jsonb_build_object(
    'members_active', (select count(*) from public.profiles where account_status = 'active'),
    'members_pending', (select count(*) from public.profiles where account_status = 'pending'),
    'listings_active', (select count(*) from public.listings where status in ('active', 'reserved')),
    'listings_pending_review', (select count(*) from public.listings where status = 'pending_review'),
    'listings_sold', (select count(*) from public.sales where completion_status = 'completed'),
    'sales_volume_cents', (select coalesce(sum(final_price_cents), 0) from public.sales where completion_status = 'completed'),
    'commissions_generated_cents', (select coalesce(sum(amount_cents), 0) from public.commissions where status not in ('cancelled', 'refunded', 'waived')),
    'commissions_received_cents', (select coalesce(sum(amount_cents), 0) from public.commissions where status = 'paid'),
    'commissions_pending_cents', (select coalesce(sum(amount_cents), 0) from public.commissions where status in ('awaiting_payment', 'payment_reported', 'under_review')),
    'commissions_overdue_cents', (select coalesce(sum(amount_cents), 0) from public.commissions where status = 'awaiting_payment' and due_at < now()),
    'commissions_to_review', (select count(*) from public.commissions where status in ('payment_reported', 'under_review')),
    'reports_open', (select count(*) from public.reports where status = 'open'),
    'top_sellers', coalesce((
      select jsonb_agg(t) from (
        select p.id, p.name, count(*) as sales, sum(s.final_price_cents) as volume_cents
        from public.sales s join public.profiles p on p.id = s.seller_id
        where s.completion_status = 'completed'
        group by p.id, p.name order by count(*) desc, sum(s.final_price_cents) desc limit 5) t), '[]'::jsonb)
  ) into v;
  return v;
end $$;

create or replace function public.admin_create_invite(p_label text default null, p_max_uses int default 1, p_days int default 7)
returns text language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := private.require_admin(); v_code text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)); v_id uuid;
begin
  if p_max_uses not between 1 and 200 or p_days not between 1 and 90 then raise exception 'Valores inválidos.'; end if;
  insert into public.invites (code_hash, label, created_by, expires_at, max_uses)
  values (private.hash_code(v_code), nullif(left(btrim(coalesce(p_label, '')), 80), ''), v_admin, now() + make_interval(days => p_days), p_max_uses)
  returning id into v_id;
  perform private.audit('invite.created', 'invite', v_id::text, jsonb_build_object('label', p_label, 'max_uses', p_max_uses, 'days', p_days));
  return substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4);
end $$;

create or replace function public.admin_revoke_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  update public.invites set revoked_at = now() where id = p_invite and revoked_at is null;
  perform private.audit('invite.revoked', 'invite', p_invite::text);
end $$;

create or replace function public.admin_set_access_code(p_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := private.require_admin();
begin
  if p_code is not null and char_length(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g')) < 6 then
    raise exception 'O código precisa ter pelo menos 6 letras ou números.';
  end if;
  update public.app_settings
     set value = case when p_code is null then 'null'::jsonb else to_jsonb(private.hash_code(p_code)) end,
         updated_by = v_admin, updated_at = now()
   where key = 'access_code_hash';
  perform private.audit('settings.access_code', 'setting', 'access_code_hash', jsonb_build_object('enabled', p_code is not null));
end $$;

create or replace function public.admin_update_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := private.require_admin(); v_old jsonb; v_int int; v_txt text;
begin
  select value into v_old from public.app_settings where key = p_key;
  if not found or p_key = 'access_code_hash' then raise exception 'Configuração desconhecida.'; end if;

  if p_key in ('commission_rate_bps', 'payment_due_days', 'overdue_grace_days', 'max_photos', 'max_active_listings') then
    if jsonb_typeof(p_value) <> 'number' then raise exception 'Valor numérico esperado.'; end if;
    v_int := (p_value #>> '{}')::numeric::int;
    if (p_key = 'commission_rate_bps' and v_int not between 0 and 5000)
       or (p_key = 'payment_due_days' and v_int not between 1 and 90)
       or (p_key = 'overdue_grace_days' and v_int not between 1 and 180)
       or (p_key = 'max_photos' and v_int not between 1 and 10)
       or (p_key = 'max_active_listings' and v_int not between 1 and 500) then
      raise exception 'Valor fora do limite permitido.';
    end if;
    p_value := to_jsonb(v_int);
  else
    if jsonb_typeof(p_value) <> 'string' then raise exception 'Texto esperado.'; end if;
    v_txt := btrim(p_value #>> '{}');
    if p_key = 'moderation_mode' and v_txt not in ('post', 'pre') then raise exception 'Modo inválido.'; end if;
    if p_key = 'app_name' and char_length(v_txt) not between 2 and 40 then raise exception 'Nome entre 2 e 40 caracteres.'; end if;
    if p_key = 'pix_key' and char_length(v_txt) > 77 then raise exception 'Chave Pix muito longa.'; end if;
    if p_key = 'pix_receiver_name' and char_length(v_txt) > 25 then raise exception 'Nome do recebedor: até 25 caracteres.'; end if;
    if p_key = 'pix_city' and char_length(v_txt) > 15 then raise exception 'Cidade: até 15 caracteres.'; end if;
    if p_key = 'participation_policy' and char_length(v_txt) > 3000 then raise exception 'Texto muito longo.'; end if;
    p_value := to_jsonb(v_txt);
  end if;

  update public.app_settings set value = p_value, updated_by = v_admin, updated_at = now() where key = p_key;
  perform private.audit('settings.update', 'setting', p_key, jsonb_build_object('from', v_old, 'to', p_value));
end $$;

create or replace function public.admin_set_user_status(p_user uuid, p_status public.account_status, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := private.require_admin(); v_old public.profiles;
begin
  if p_status not in ('active', 'suspended') then raise exception 'Situação inválida.'; end if;
  select * into v_old from public.profiles where id = p_user for update;
  if not found or v_old.account_status = 'deleted' then raise exception 'Membro não encontrado.'; end if;
  if p_user = v_admin and p_status <> 'active' then raise exception 'Você não pode suspender a própria conta.'; end if;
  update public.profiles set account_status = p_status, updated_at = now() where id = p_user;
  if p_status = 'suspended' then
    update public.listings set status = 'paused', updated_at = now() where seller_id = p_user and status in ('active', 'reserved', 'pending_review');
  end if;
  perform private.audit('user.status', 'profile', p_user::text, jsonb_build_object('from', v_old.account_status, 'to', p_status, 'reason', p_reason));
  perform private.notify(p_user, 'account_status',
    case when p_status = 'active' then 'Sua conta está ativa. Bem-vindo(a)!' else 'Sua conta foi suspensa' end,
    p_reason, '/', 'account:' || p_status);
end $$;

create or replace function public.admin_set_user_role(p_user uuid, p_role public.user_role)
returns void language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := private.require_admin(); v_old public.profiles;
begin
  if p_role = 'moderator' then raise exception 'Moderadores ainda não estão disponíveis.'; end if;
  select * into v_old from public.profiles where id = p_user for update;
  if not found or v_old.account_status <> 'active' then raise exception 'Membro precisa estar ativo.'; end if;
  if v_old.role = 'admin' and p_role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin' and account_status = 'active') <= 1 then
    raise exception 'É preciso manter pelo menos um administrador.';
  end if;
  update public.profiles set role = p_role, updated_at = now() where id = p_user;
  perform private.audit('user.role', 'profile', p_user::text, jsonb_build_object('from', v_old.role, 'to', p_role));
end $$;

create or replace function public.admin_moderate_listing(p_listing uuid, p_action text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := private.require_admin(); v_l public.listings; v_new public.listing_status;
begin
  select * into v_l from public.listings where id = p_listing for update;
  if not found then raise exception 'Anúncio não encontrado.'; end if;
  if v_l.status = 'sold' then raise exception 'Anúncio vendido: cancele a venda primeiro, se necessário.'; end if;
  v_new := case p_action
    when 'approve' then 'active' when 'restore' then 'active'
    when 'suspend' then 'suspended' when 'remove' then 'deleted' end;
  if v_new is null then raise exception 'Ação inválida.'; end if;
  if p_action in ('suspend', 'remove') and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Informe o motivo.';
  end if;
  update public.listings
     set status = v_new, published_at = case when v_new = 'active' then coalesce(published_at, now()) else published_at end, updated_at = now()
   where id = p_listing;
  perform private.audit('listing.' || p_action, 'listing', p_listing::text, jsonb_build_object('from', v_l.status, 'to', v_new, 'reason', p_reason));
  perform private.notify(v_l.seller_id, 'listing_moderated',
    case p_action when 'approve' then 'Anúncio aprovado' when 'restore' then 'Anúncio reativado'
                  when 'suspend' then 'Anúncio suspenso' else 'Anúncio removido' end,
    v_l.title || coalesce(' · ' || p_reason, ''), '/anuncio/' || p_listing, 'moderation:' || p_listing);
end $$;

create or replace function public.admin_resolve_report(p_report uuid, p_status public.report_status, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := private.require_admin(); v_r public.reports;
begin
  if p_status = 'open' then raise exception 'Situação inválida.'; end if;
  select * into v_r from public.reports where id = p_report for update;
  if not found then raise exception 'Denúncia não encontrada.'; end if;
  update public.reports set status = p_status, resolved_by = v_admin, resolved_at = now(),
                            resolution_note = nullif(left(btrim(coalesce(p_note, '')), 1000), '')
   where id = p_report;
  perform private.audit('report.' || p_status, 'report', p_report::text, jsonb_build_object('note', p_note));
  perform private.notify(v_r.reporter_id, 'report_resolved', 'Sua denúncia foi analisada', p_note, null, 'report:' || p_report);
end $$;

create or replace function public.admin_upsert_category(p_id text, p_name text, p_icon text, p_sort int, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  insert into public.categories (id, name, icon, sort_order, active)
  values (p_id, btrim(p_name), coalesce(nullif(btrim(p_icon), ''), 'package'), coalesce(p_sort, 100), coalesce(p_active, true))
  on conflict (id) do update set name = excluded.name, icon = excluded.icon, sort_order = excluded.sort_order, active = excluded.active;
  perform private.audit('category.upsert', 'category', p_id, jsonb_build_object('name', p_name, 'active', p_active));
end $$;

create or replace function public.admin_user_summary(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform private.require_admin();
  select jsonb_build_object(
    'phone', (select phone from public.profile_private where user_id = p_user),
    'listings_active', (select count(*) from public.listings where seller_id = p_user and status in ('active', 'reserved', 'paused')),
    'sales', (select count(*) from public.sales where seller_id = p_user and completion_status = 'completed'),
    'sales_volume_cents', (select coalesce(sum(final_price_cents), 0) from public.sales where seller_id = p_user and completion_status = 'completed'),
    'purchases', (select count(*) from public.sales where buyer_id = p_user and completion_status = 'completed'),
    'commissions_paid_cents', (select coalesce(sum(amount_cents), 0) from public.commissions where seller_id = p_user and status = 'paid'),
    'commissions_open_cents', (select coalesce(sum(amount_cents), 0) from public.commissions where seller_id = p_user and status in ('awaiting_payment', 'payment_reported', 'under_review')),
    'restricted', public.member_is_restricted(p_user)
  ) into v;
  return v;
end $$;

-- comprovantes: o administrador abre o arquivo por um link temporário gerado pelo app
create or replace function private.receipt_owner(p_path text)
returns uuid language sql immutable set search_path = '' as $$
  select case when p_path ~ '^[0-9a-f-]{36}/' then substr(p_path, 1, 36)::uuid end
$$;
