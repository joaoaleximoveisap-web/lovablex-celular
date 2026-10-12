-- Desapego da Família — permissões
-- Camada 1: GRANTs explícitos por coluna (o app só consegue escrever o que está listado aqui).
-- Camada 2: RLS em todas as tabelas (cada linha só é vista/alterada por quem tem direito).
-- Camada 3: funções do servidor para tudo que envolve dinheiro, status ou outra pessoa.

-- ---------------------------------------------------------------- privilégios
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;   -- só para os gatilhos de validação; nada aqui é exposto pela API

grant select on public.profiles to authenticated;
grant update (name, avatar_url, location, contact_preferences) on public.profiles to authenticated;
grant select on public.profile_private to authenticated;
grant select on public.invites to authenticated;
grant select, insert (blocked_id), delete on public.user_blocks to authenticated;
grant select on public.categories to anon, authenticated;
grant select on public.listings to authenticated;
grant insert (category_id, title, description, asking_price_cents, condition, listing_type, accepts_offers,
              accepts_trade, location, delivery_options, notes, status) on public.listings to authenticated;
grant update (category_id, title, description, asking_price_cents, condition, listing_type, accepts_offers,
              accepts_trade, location, delivery_options, notes, status) on public.listings to authenticated;
grant select, delete on public.listing_images to authenticated;
grant insert (listing_id, storage_path, thumb_path, width, height, display_order) on public.listing_images to authenticated;
grant update (display_order) on public.listing_images to authenticated;
grant select, insert (listing_id), delete on public.favorites to authenticated;
grant select on public.conversations to authenticated;
grant select on public.messages to authenticated;
grant insert (conversation_id, content, client_id) on public.messages to authenticated;
grant select on public.offers to authenticated;
grant select on public.sales to authenticated;
grant select on public.commissions to authenticated;
grant select on public.commissions_view to authenticated;
grant select on public.payment_reports to authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select on public.reports to authenticated;
grant insert (target_type, target_id, reason, details) on public.reports to authenticated;
grant select on public.app_settings to authenticated;
grant select on public.audit_logs to authenticated;

-- funções que o app pode chamar
grant execute on function public.check_invite(text) to anon, authenticated;
grant execute on function public.public_branding() to anon, authenticated;
grant execute on function public.is_active_member() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;
grant execute on function public.member_is_restricted(uuid) to authenticated;
grant execute on function public.calc_commission_cents(bigint, int) to authenticated;
grant execute on function public.fold_text(text) to authenticated;
grant execute on function public.update_my_private(text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.search_listings(text, text, bigint, bigint, public.listing_condition[], text, boolean, boolean, boolean, int, boolean, uuid, uuid, text, int, int) to authenticated;
grant execute on function public.start_conversation(uuid) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.share_whatsapp(uuid) to authenticated;
grant execute on function public.my_conversations() to authenticated;
grant execute on function public.unread_counts() to authenticated;
grant execute on function public.make_offer(uuid, bigint, uuid) to authenticated;
grant execute on function public.respond_offer(uuid, text, bigint) to authenticated;
grant execute on function public.cancel_offer(uuid) to authenticated;
grant execute on function public.mark_listing_sold(uuid, bigint, public.sale_type, uuid, text, uuid, uuid) to authenticated;
grant execute on function public.confirm_purchase(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_sale(uuid, text) to authenticated;
grant execute on function public.sync_my_reminders() to authenticated;
grant execute on function public.report_payment(uuid, text, text, uuid) to authenticated;
-- as funções admin_* conferem o papel de administrador por dentro
grant execute on function public.admin_commission_action(uuid, text, text, bigint) to authenticated;
grant execute on function public.admin_send_reminder(uuid) to authenticated;
grant execute on function public.admin_dashboard() to authenticated;
grant execute on function public.admin_create_invite(text, int, int) to authenticated;
grant execute on function public.admin_revoke_invite(uuid) to authenticated;
grant execute on function public.admin_set_access_code(text) to authenticated;
grant execute on function public.admin_update_setting(text, jsonb) to authenticated;
grant execute on function public.admin_set_user_status(uuid, public.account_status, text) to authenticated;
grant execute on function public.admin_set_user_role(uuid, public.user_role) to authenticated;
grant execute on function public.admin_moderate_listing(uuid, text, text) to authenticated;
grant execute on function public.admin_resolve_report(uuid, public.report_status, text) to authenticated;
grant execute on function public.admin_upsert_category(text, text, text, int, boolean) to authenticated;
grant execute on function public.admin_user_summary(uuid) to authenticated;
-- usadas pelos gatilhos de validação (rodam como o usuário)
grant execute on function private.setting_int(text, int) to authenticated;
grant execute on function private.setting_text(text) to authenticated;
-- public.create_owner_invite() fica de fora de propósito: só pelo SQL Editor do Supabase.

-- ---------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.invites enable row level security;
alter table public.user_blocks enable row level security;
alter table public.categories enable row level security;
alter table public.listings enable row level security;
alter table public.listing_images enable row level security;
alter table public.favorites enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.offers enable row level security;
alter table public.sales enable row level security;
alter table public.commissions enable row level security;
alter table public.payment_reports enable row level security;
alter table public.notifications enable row level security;
alter table public.reports enable row level security;
alter table public.app_settings enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin() or public.is_active_member());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() and account_status in ('active', 'pending')) with check (id = auth.uid());

create policy profile_private_select on public.profile_private for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy invites_admin on public.invites for select to authenticated using (public.is_admin());

create policy blocks_select on public.user_blocks for select to authenticated using (blocker_id = auth.uid());
create policy blocks_insert on public.user_blocks for insert to authenticated
  with check (blocker_id = auth.uid() and public.is_active_member());
create policy blocks_delete on public.user_blocks for delete to authenticated using (blocker_id = auth.uid());

create policy categories_select on public.categories for select to anon, authenticated
  using (active or public.is_admin());

create policy listings_select on public.listings for select to authenticated
  using (seller_id = auth.uid()
         or public.is_staff()
         or (status in ('active', 'reserved', 'paused', 'sold') and public.is_active_member()));
create policy listings_insert on public.listings for insert to authenticated
  with check (seller_id = auth.uid() and public.is_active_member());
create policy listings_update_own on public.listings for update to authenticated
  using (seller_id = auth.uid()) with check (seller_id = auth.uid());

create policy listing_images_select on public.listing_images for select to authenticated
  using (exists (select 1 from public.listings l where l.id = listing_id));
create policy listing_images_insert on public.listing_images for insert to authenticated
  with check (exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid()));
create policy listing_images_update on public.listing_images for update to authenticated
  using (exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid()));
create policy listing_images_delete on public.listing_images for delete to authenticated
  using (exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid()));

create policy favorites_own_select on public.favorites for select to authenticated using (user_id = auth.uid());
create policy favorites_own_insert on public.favorites for insert to authenticated
  with check (user_id = auth.uid() and public.is_active_member());
create policy favorites_own_delete on public.favorites for delete to authenticated using (user_id = auth.uid());

-- conversas e mensagens: somente os dois participantes (nem o administrador lê)
create policy conversations_participants on public.conversations for select to authenticated
  using (auth.uid() in (buyer_id, seller_id));
create policy messages_participants_select on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id)));
create policy messages_participants_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid()
              and exists (select 1 from public.conversations c where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id)));

create policy offers_parties on public.offers for select to authenticated
  using (auth.uid() in (buyer_id, seller_id) or public.is_admin());

create policy sales_parties on public.sales for select to authenticated
  using (auth.uid() = seller_id or auth.uid() = buyer_id or public.is_admin());

-- financeiro: cada membro vê só o próprio; ninguém altera direto (só funções do servidor)
create policy commissions_owner on public.commissions for select to authenticated
  using (seller_id = auth.uid() or public.is_admin());
create policy payment_reports_owner on public.payment_reports for select to authenticated
  using (reported_by = auth.uid() or public.is_admin());

create policy notifications_own_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_own_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_own_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

create policy reports_select on public.reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_staff());
create policy reports_insert on public.reports for insert to authenticated
  with check (reporter_id = auth.uid() and public.is_active_member());

create policy settings_select on public.app_settings for select to authenticated
  using ((is_public and public.is_active_member()) or public.is_admin());

create policy audit_admin on public.audit_logs for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------- tempo real (chat e avisos sem recarregar)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.notifications;
  end if;
end $$;
