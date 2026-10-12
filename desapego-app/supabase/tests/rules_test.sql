-- Testes das regras de negócio e permissões, executados como os papéis reais do Supabase
-- (authenticated + auth.uid()), do mesmo jeito que o app chega pela API.
\set QUIET 1
set client_min_messages = notice;

create schema test;
grant usage on schema test to authenticated, anon;
create function test.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok - %', msg;
end $$;
create function test.fails(stmt text, pattern text, msg text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm ilike '%' || pattern || '%' then
      raise notice 'ok - % (bloqueado: %)', msg, sqlerrm;
      return;
    end if;
    raise exception 'FALHOU: % — erro inesperado: %', msg, sqlerrm;
  end;
  raise exception 'FALHOU: % — deveria ter sido bloqueado', msg;
end $$;
create function test.n(stmt text) returns bigint language plpgsql as $$
declare v bigint;
begin
  execute stmt into v;
  return v;
end $$;
grant execute on all functions in schema test to authenticated, anon;

\set admin '''a0000000-0000-0000-0000-000000000001'''
\set maria '''a0000000-0000-0000-0000-000000000002'''
\set joao  '''a0000000-0000-0000-0000-000000000003'''
\set pedro '''a0000000-0000-0000-0000-000000000004'''
\set ana   '''a0000000-0000-0000-0000-000000000005'''
\set as_admin 'reset role; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000001"}'', false); set role authenticated;'
\set as_maria 'reset role; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000002"}'', false); set role authenticated;'
\set as_joao  'reset role; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000003"}'', false); set role authenticated;'
\set as_pedro 'reset role; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000004"}'', false); set role authenticated;'
\set as_ana   'reset role; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000005"}'', false); set role authenticated;'
\set as_anon  'reset role; select set_config(''request.jwt.claims'', '''', false); set role anon;'
\set as_server 'reset role; select set_config(''request.jwt.claims'', '''', false);'

\o /dev/null
-- ============================================================ cadastro por convite
:as_server
select test.ok(public.calc_commission_cents(90000, 500) = 4500, 'comissão de 5% sobre R$ 900 = R$ 45,00');
select test.ok(public.calc_commission_cents(100000, 500) = 5000, 'comissão de 5% sobre R$ 1.000 = R$ 50,00');
select test.ok(public.calc_commission_cents(999, 500) = 50, 'arredondamento: 5% de R$ 9,99 = R$ 0,50');
select test.ok(public.calc_commission_cents(1, 500) = 0, 'arredondamento: 5% de R$ 0,01 = R$ 0,00');
select test.ok(public.calc_commission_cents(12345, 750) = 926, '7,5% de R$ 123,45 = R$ 9,26');
select test.ok(public.calc_commission_cents(0, 500) = 0, 'sem valor, sem comissão');

select test.fails($$insert into auth.users (id, email, raw_user_meta_data)
  values (gen_random_uuid(), 'x@x', '{"name":"Intruso","invite_code":"NAOEXISTE","accepted_terms":"true"}')$$,
  'Convite inválido', 'cadastro sem convite válido é recusado');

select public.create_owner_invite() as owner_code \gset
insert into auth.users (id, email, raw_user_meta_data)
values (:admin, 'dono@familia.test', jsonb_build_object('name', 'Dono', 'invite_code', :'owner_code', 'accepted_terms', 'true'));
select test.ok((select role = 'admin' and account_status = 'active' from public.profiles where id = :admin), 'convite do dono cria o administrador');
select test.fails(format($$insert into auth.users (id, email, raw_user_meta_data)
  values (gen_random_uuid(), 'y@x', '{"name":"Outro","invite_code":"%s","accepted_terms":"true"}')$$, :'owner_code'),
  'Convite inválido', 'convite de uso único não serve duas vezes');

:as_admin
select public.admin_create_invite('Família', 3, 7) as fam_code \gset
select public.admin_create_invite('Pedro', 1, 7) as pedro_code \gset
:as_server
select test.fails(format($$insert into auth.users (id, email, raw_user_meta_data)
  values (gen_random_uuid(), 'z@x', '{"name":"Sem termos","invite_code":"%s"}')$$, :'fam_code'),
  'termos', 'cadastro exige aceitar os termos');
insert into auth.users (id, email, raw_user_meta_data) values
  (:maria, 'maria@familia.test', jsonb_build_object('name', 'Maria', 'invite_code', lower(:'fam_code'), 'accepted_terms', 'true', 'phone', '(43) 99999-0000')),
  (:joao,  'joao@familia.test',  jsonb_build_object('name', 'João',  'invite_code', :'fam_code', 'accepted_terms', 'true')),
  (:pedro, 'pedro@familia.test', jsonb_build_object('name', 'Pedro', 'invite_code', :'pedro_code', 'accepted_terms', 'true'));
select test.ok((select count(*) = 3 from public.profiles where role = 'member' and account_status = 'active'), 'familiares entram ativos pelo convite (código aceita minúsculas)');
select test.ok((select use_count = 2 from public.invites where label = 'Família'), 'uso do convite é contado');

:as_anon
select test.ok((public.check_invite(:'fam_code') ->> 'valid')::boolean, 'visitante consegue validar convite antes do cadastro');
select test.ok(not (public.check_invite('ERRADO123') ->> 'valid')::boolean, 'código errado é inválido');
select test.fails('select * from public.listings', 'permission denied', 'visitante sem login não vê anúncios');

-- código geral de acesso: entra como pendente e o administrador aprova
:as_admin
select public.admin_set_access_code('FAMILIA2026');
:as_server
insert into auth.users (id, email, raw_user_meta_data)
values (:ana, 'ana@familia.test', jsonb_build_object('name', 'Ana', 'invite_code', 'familia-2026', 'accepted_terms', 'true'));
select test.ok((select account_status = 'pending' from public.profiles where id = :ana), 'código de acesso cria cadastro pendente');
:as_ana
select test.fails($$insert into public.listings (category_id, title, asking_price_cents, condition, status) values ('casa', 'Abajur', 3000, 'usado', 'active')$$,
  'não está ativa', 'cadastro pendente não anuncia');
:as_admin
select public.admin_set_user_status(:ana, 'active', 'Prima confirmada');
select test.ok((select account_status = 'active' from public.profiles where id = :ana), 'administrador aprova cadastro');
select test.ok((select count(*) > 0 from public.audit_logs where action = 'user.status'), 'aprovação registrada na auditoria');

-- ============================================================ Cenário A — anunciante
:as_maria
insert into public.listings (category_id, title, description, asking_price_cents, condition, accepts_offers, location, delivery_options, status)
values ('eletronicos', 'Televisão 50" 4K', 'Funcionando perfeitamente, com controle.', 100000, 'usado', true, 'Gleba Palhano', array['retirada'], 'active')
returning id as tv \gset
insert into public.listing_images (listing_id, storage_path, thumb_path, display_order)
select :'tv', :maria || '/' || :'tv' || '/' || g || '.webp', :maria || '/' || :'tv' || '/' || g || '_t.webp', g from generate_series(0, 3) g;
select test.ok((select status = 'active' and published_at is not null and image_count = 4
                       and cover_thumb_path like '%/0_t.webp' from public.listings where id = :'tv'),
               'anúncio publicado com 4 fotos e capa definida');
select test.fails(format($$insert into public.listing_images (listing_id, storage_path, thumb_path) values ('%s', 'outra-pasta/x.webp', 'outra-pasta/x_t.webp')$$, :'tv'),
  'inválido', 'foto precisa estar na pasta do próprio vendedor');
select test.fails($$insert into public.listings (category_id, title, asking_price_cents, condition, status) values ('casa', 'Grátis?', 0, 'usado', 'active')$$,
  'sale_has_price', 'venda precisa de preço');

:as_joao
select test.ok(test.n(format('select count(*) from public.search_listings(p_query => %L)', 'televisão')) = 1, 'comprador encontra a TV pela busca');
select test.ok(test.n(format('select count(*) from public.search_listings(p_query => %L)', 'telev 4k')) = 1, 'busca por parte da palavra encontra a TV');
select test.ok(test.n(format('select count(*) from public.search_listings(p_query => %L)', 'televisao')) = 1, 'busca sem acento encontra a TV');
select test.ok(test.n(format('select count(*) from public.search_listings(p_query => %L)', 'geladeira')) = 0, 'busca sem resultado volta vazia');
select test.ok(test.n(format('select count(*) from public.search_listings(p_location => %L)', 'palhano')) = 1, 'filtro por bairro');
select test.ok(test.n($$select count(*) from public.search_listings(p_max_cents => 10000)$$) = 0, 'filtro "até R$ 100" não mostra a TV');
select test.ok(test.n($$select count(*) from public.search_listings(p_category => 'eletronicos', p_sort => 'price_asc')$$) = 1, 'filtro por categoria');

-- ============================================================ Cenário B — comprador
:as_joao
select public.make_offer(:'tv', 90000, 'b0000000-0000-0000-0000-00000000000b') as offer1 \gset
select test.ok(public.make_offer(:'tv', 90000, 'b0000000-0000-0000-0000-00000000000b') = :'offer1', 'toque duplo na proposta não duplica');
select public.start_conversation(:'tv') as conv \gset
insert into public.messages (conversation_id, content, client_id) values (:'conv', 'Ainda está disponível?', 'c0000000-0000-0000-0000-00000000000c');
select test.fails(format($$insert into public.messages (conversation_id, content, client_id) values ('%s', 'repetida', 'c0000000-0000-0000-0000-00000000000c')$$, :'conv'),
  'duplicate key', 'mensagem reenviada com o mesmo id não duplica');
select test.fails(format($$select public.respond_offer('%s', 'accept')$$, :'offer1'), 'Aguarde', 'quem propôs não aceita a própria proposta');
:as_maria
select test.ok((select unread from public.my_conversations() where id = :'conv') = 2, 'vendedor vê 2 mensagens não lidas (proposta + texto)');
select test.ok((select count(*) = 1 from public.notifications where user_id = :maria and type = 'message'), 'uma notificação por conversa, sem duplicar');
select public.mark_conversation_read(:'conv');
select test.ok((select unread from public.my_conversations() where id = :'conv') = 0, 'conversa marcada como lida');
select public.respond_offer(:'offer1', 'counter', 95000) as offer2 \gset
:as_joao
select public.respond_offer(:'offer2', 'reject');
select public.make_offer(:'tv', 90000) as offer3 \gset
:as_maria
select public.respond_offer(:'offer3', 'accept');
select test.ok((select status = 'accepted' from public.offers where id = :'offer3'), 'vendedor aceita proposta de R$ 900');
select test.ok((select status = 'active' from public.listings where id = :'tv'), 'proposta aceita não significa vendido');
select test.ok((select count(*) = 0 from public.sales where listing_id = :'tv'), 'proposta aceita não gera venda nem comissão');

-- ============================================================ Cenário E — tentativas indevidas (antes da venda)
:as_pedro
select test.fails('select public.admin_dashboard()', 'administrador', 'membro comum não abre o painel administrativo');
select test.fails(format($$select public.admin_moderate_listing('%s', 'remove', 'teste')$$, :'tv'), 'administrador', 'membro comum não modera anúncios');
select test.fails($$select public.admin_update_setting('commission_rate_bps', '0')$$, 'administrador', 'membro comum não altera a comissão');
select test.ok(test.n(format($$with u as (update public.listings set asking_price_cents = 1 where id = '%s' returning 1) select count(*) from u$$, :'tv')) = 0,
  'membro não edita anúncio de outro familiar');
select test.fails(format($$update public.listings set seller_id = auth.uid() where id = '%s'$$, :'tv'), 'permission denied', 'membro não troca o dono de um anúncio');
select test.ok(test.n(format($$with u as (update public.listings set status = 'paused' where id = '%s' returning 1) select count(*) from u$$, :'tv')) = 0, 'membro não pausa anúncio alheio');
select test.fails(format($$select public.mark_listing_sold('%s', 100)$$, :'tv'), 'não encontrado', 'membro não declara venda de anúncio alheio');
select test.ok(test.n(format($$select count(*) from public.messages where conversation_id = '%s'$$, :'conv')) = 0, 'membro não lê conversa dos outros');
select test.fails(format($$insert into public.messages (conversation_id, content) values ('%s', 'oi')$$, :'conv'), 'Conversa não encontrada', 'membro não escreve em conversa dos outros');
select test.ok(test.n('select count(*) from public.profile_private') = 1, 'membro só vê o próprio telefone');
select test.ok(test.n($$select count(*) from public.app_settings where key = 'access_code_hash'$$) = 0, 'código de acesso não é visível para membros');
select test.ok(test.n('select count(*) from public.audit_logs') = 0, 'membro não vê auditoria');
select test.ok(test.n('select count(*) from public.invites') = 0, 'membro não vê convites');
select test.fails($$select public.create_owner_invite()$$, 'permission denied', 'app não consegue criar convite de administrador');
select test.fails($$update public.profiles set role = 'admin' where id = auth.uid()$$, 'permission denied', 'membro não se promove a administrador');
select test.fails($$update public.profiles set account_status = 'active' where id = auth.uid()$$, 'permission denied', 'membro não muda a própria situação');
:as_admin
select test.ok(test.n(format($$select count(*) from public.messages where conversation_id = '%s'$$, :'conv')) = 0, 'nem o administrador lê mensagens privadas');

-- ============================================================ Cenário C — venda
:as_maria
select public.mark_listing_sold(:'tv', 90000, 'venda', null, null, :'offer3', 'd0000000-0000-0000-0000-00000000000d') as sale \gset
select test.ok(public.mark_listing_sold(:'tv', 90000, 'venda', null, null, :'offer3', 'd0000000-0000-0000-0000-00000000000d') = :'sale',
  'confirmar venda duas vezes (mesmo pedido) não duplica');
select test.fails(format($$select public.mark_listing_sold('%s', 90000)$$, :'tv'), 'não pode ser marcado', 'anúncio vendido não é vendido de novo');
select test.ok((select buyer_id = :joao and final_price_cents = 90000 and commission_rate_snapshot = 500 and commission_cents = 4500
                from public.sales where id = :'sale'), 'venda registrada por R$ 900 com taxa congelada de 5%');
select test.ok((select status = 'sold' and sold_at is not null from public.listings where id = :'tv'), 'disponibilidade atualizada: vendido');
select test.ok((select amount_cents = 4500 and status = 'awaiting_payment' and due_at > now() + interval '6 days'
                from public.commissions where sale_id = :'sale'), 'cobrança de R$ 45,00 gerada com vencimento em 7 dias');
select id as comm from public.commissions where sale_id = :'sale' \gset
select test.ok((select effective_status = 'awaiting_payment' from public.commissions_view where id = :'comm'), 'situação: aguardando pagamento');
select test.ok((select count(*) = 1 from public.app_settings where key = 'pix_key'), 'vendedor lê a chave Pix do administrador');
select test.fails($$update public.commissions set status = 'paid'$$, 'permission denied', 'vendedor não altera comissão diretamente');
select test.fails(format($$select public.admin_commission_action('%s', 'confirm_paid')$$, :'comm'), 'administrador', 'vendedor não confirma a própria comissão como paga');
select test.fails(format($$select public.admin_commission_action('%s', 'waive', 'quero isenção')$$, :'comm'), 'administrador', 'vendedor não se isenta');
:as_joao
select test.fails(format($$select public.make_offer('%s', 80000)$$, :'tv'), 'não está recebendo', 'não aceita proposta em anúncio vendido');
select test.ok(test.n('select count(*) from public.commissions') = 0, 'comprador não vê comissões do vendedor');
select test.ok(test.n('select count(*) from public.sales') = 1, 'comprador vê a própria compra');
select public.confirm_purchase(:'sale', true);
select test.ok((select buyer_confirmation = 'confirmed' from public.sales where id = :'sale'), 'comprador confirma a compra');
:as_pedro
select test.ok(test.n('select count(*) from public.sales') = 0, 'terceiros não veem a venda');
select test.ok(test.n('select count(*) from public.commissions_view') = 0, 'terceiros não veem a cobrança');

-- ============================================================ Cenário D — administração
:as_admin
select test.ok((public.admin_dashboard() ->> 'commissions_pending_cents')::bigint = 4500, 'painel mostra R$ 45 pendentes');
select test.ok((public.admin_dashboard() ->> 'commissions_received_cents')::bigint = 0, 'nada consta como recebido antes da conferência');
select test.ok((public.admin_dashboard() ->> 'sales_volume_cents')::bigint = 90000, 'volume declarado R$ 900');
:as_maria
select test.fails(format($$select public.report_payment('%s', 'outra-pessoa/comprovante.jpg')$$, :'comm'), 'inválido', 'comprovante precisa estar na pasta do vendedor');
select public.report_payment(:'comm', :maria || '/comprovante.jpg', 'Pix feito às 10h', 'e0000000-0000-0000-0000-00000000000e');
select public.report_payment(:'comm', :maria || '/comprovante.jpg', 'Pix feito às 10h', 'e0000000-0000-0000-0000-00000000000e');
select test.ok((select count(*) = 1 from public.payment_reports where commission_id = :'comm'), 'informar pagamento duas vezes não duplica');
select test.ok((select status = 'payment_reported' from public.commissions where id = :'comm'), 'situação: pagamento informado (não é "pago")');
:as_admin
select test.ok((public.admin_dashboard() ->> 'commissions_received_cents')::bigint = 0, 'pagamento informado ainda não é receita recebida');
select public.admin_commission_action(:'comm', 'start_review');
select test.ok((select status = 'under_review' from public.commissions where id = :'comm'), 'situação: em conferência');
select public.admin_commission_action(:'comm', 'confirm_paid');
select test.ok((select status = 'paid' and paid_at is not null and verified_by = :admin from public.commissions where id = :'comm'), 'administrador confirma recebimento');
select test.ok((public.admin_dashboard() ->> 'commissions_received_cents')::bigint = 4500, 'R$ 45 passam a constar como recebidos');
select test.ok((public.admin_dashboard() ->> 'commissions_pending_cents')::bigint = 0, 'nada mais pendente');
select test.ok((select count(*) >= 2 from public.audit_logs where resource_id = :'comm'), 'conferência registrada na auditoria');
select test.fails(format($$select public.admin_commission_action('%s', 'confirm_paid')$$, :'comm'), 'não permite', 'não confirma duas vezes');
:as_maria
select test.fails(format($$select public.cancel_sale('%s', 'desisti')$$, :'sale'), 'administrador', 'vendedor não cancela venda com comissão já paga');

-- ============================================================ taxa não muda vendas antigas
:as_admin
select public.admin_update_setting('commission_rate_bps', '1000');
select test.fails($$select public.admin_update_setting('commission_rate_bps', '9000')$$, 'limite', 'taxa acima de 50% é recusada');
select test.ok((select amount_cents = 4500 and rate_bps = 500 from public.commissions where id = :'comm'), 'mudar a taxa não altera comissão já registrada');
:as_maria
insert into public.listings (category_id, title, asking_price_cents, condition, status) values ('moveis', 'Sofá 3 lugares', 65000, 'seminovo', 'active') returning id as sofa \gset
select public.mark_listing_sold(:'sofa', 60000, 'venda', null, 'Vizinho', null, null) as sale2 \gset
select test.ok((select commission_cents = 6000 and commission_rate_snapshot = 1000 from public.sales where id = :'sale2'), 'venda nova usa a taxa nova (10%)');
select test.ok((select buyer_confirmation = 'not_applicable' and buyer_external_name = 'Vizinho' from public.sales where id = :'sale2'), 'venda para alguém de fora do app');

-- ============================================================ venda cancelada
select public.cancel_sale(:'sale2', 'Comprador desistiu');
select test.ok((select completion_status = 'cancelled' from public.sales where id = :'sale2'), 'venda cancelada');
select test.ok((select status = 'cancelled' from public.commissions where sale_id = :'sale2'), 'venda cancelada: nenhuma comissão devida');
select test.ok((select status = 'active' from public.listings where id = :'sofa'), 'anúncio volta para a vitrine');
select public.mark_listing_sold(:'sofa', 62000) as sale3 \gset
select test.ok((select count(*) = 1 from public.sales where listing_id = :'sofa' and completion_status = 'completed'), 'pode ser vendido de novo após cancelamento');
:as_admin
select public.admin_update_setting('commission_rate_bps', '500');

-- ============================================================ doação e troca
:as_maria
insert into public.listings (category_id, title, asking_price_cents, condition, listing_type, status) values ('infantil', 'Roupinhas de bebê', 5000, 'usado', 'doacao', 'active') returning id as doa \gset
select test.ok((select asking_price_cents = 0 and not accepts_offers from public.listings where id = :'doa'), 'doação fica sem preço e sem propostas');
select public.mark_listing_sold(:'doa', 0, 'doacao', :joao) as sale_doa \gset
select test.ok((select commission_cents = 0 from public.sales where id = :'sale_doa') and not exists (select 1 from public.commissions where sale_id = :'sale_doa'), 'doação: comissão zero');
insert into public.listings (category_id, title, asking_price_cents, condition, accepts_trade, status) values ('esportes', 'Bicicleta aro 29', 85000, 'usado', true, 'active') returning id as bike \gset
select public.mark_listing_sold(:'bike', 0, 'troca', :joao) as sale_troca \gset
select test.ok((select commission_cents = 0 from public.sales where id = :'sale_troca'), 'troca sem pagamento: comissão zero');

-- ============================================================ propostas simultâneas e bloqueios
insert into public.listings (category_id, title, asking_price_cents, condition, status) values ('casa', 'Mesa de jantar', 40000, 'seminovo', 'active') returning id as mesa \gset
:as_joao
select public.make_offer(:'mesa', 30000) as o_joao \gset
:as_pedro
select public.make_offer(:'mesa', 32000) as o_pedro \gset
:as_joao
select public.make_offer(:'mesa', 33000) as o_joao2 \gset
select test.ok((select status = 'cancelled' from public.offers where id = :'o_joao'), 'nova proposta do mesmo comprador substitui a anterior');
select test.ok((select count(*) = 1 from public.offers where listing_id = :'mesa' and buyer_id = auth.uid() and status = 'pending'), 'só uma proposta em aberto por comprador');
:as_maria
select test.ok((select count(*) = 2 from public.offers where listing_id = :'mesa' and status = 'pending'), 'vendedor vê as duas propostas simultâneas');
update public.listings set status = 'deleted' where id = :'mesa';
select test.ok((select count(*) = 0 from public.offers where listing_id = :'mesa' and status = 'pending'), 'excluir anúncio encerra propostas em aberto');
:as_pedro
select test.fails(format($$select public.respond_offer('%s', 'accept')$$, :'o_pedro'), 'já foi respondida', 'proposta encerrada não pode ser aceita');
select test.fails(format($$select public.make_offer('%s', 1000)$$, :'mesa'), 'não está recebendo', 'não aceita proposta em anúncio excluído');
:as_maria
select test.fails(format($$update public.listings set status = 'active' where id = '%s'$$, :'mesa'), 'não pode mais', 'anúncio excluído não volta');

insert into public.listings (category_id, title, asking_price_cents, condition, status) values ('livros', 'Coleção Harry Potter', 15000, 'usado', 'active') returning id as livros \gset
:as_pedro
select public.start_conversation(:'livros') as conv_pedro \gset
:as_maria
insert into public.user_blocks (blocked_id) values (:pedro);
:as_pedro
select test.fails(format($$insert into public.messages (conversation_id, content) values ('%s', 'oi')$$, :'conv_pedro'), 'Não é possível', 'membro bloqueado não envia mensagens');
select test.fails(format($$select public.make_offer('%s', 10000)$$, :'livros'), 'Não é possível', 'membro bloqueado não faz propostas');


-- ============================================================ atraso, aviso e restrição
:as_maria
select public.mark_listing_sold(:'livros', 15000) as sale_livros \gset
select id as comm_livros from public.commissions where sale_id = :'sale_livros' \gset
:as_server
update public.commissions set due_at = now() - interval '1 day' where id = :'comm_livros';
:as_maria
select test.ok((select effective_status = 'overdue' from public.commissions_view where id = :'comm_livros'), 'comissão vencida aparece em atraso (sem tarefa agendada)');
select test.ok(not public.member_is_restricted(auth.uid()), 'sem aviso, não há restrição');
select test.ok(public.sync_my_reminders() = 1, 'lembrete de pagamento enviado ao abrir o app');
select test.ok(public.sync_my_reminders() = 0, 'lembrete não é repetido');
select test.ok(not public.member_is_restricted(auth.uid()), 'dentro do prazo de tolerância, ainda pode anunciar');
:as_server
update public.commissions set reminder_sent_at = now() - interval '11 days' where id = :'comm_livros';
:as_maria
select test.ok(public.member_is_restricted(auth.uid()), 'após aviso + prazo configurável, membro fica restrito');
select test.fails($$insert into public.listings (category_id, title, asking_price_cents, condition, status) values ('casa', 'Luminária', 3000, 'usado', 'active')$$,
  'bloqueados', 'restrito não publica anúncio novo');
insert into public.listings (category_id, title, asking_price_cents, condition, status) values ('casa', 'Luminária', 3000, 'usado', 'draft') returning id as rascunho \gset
select test.ok((select status = 'draft' from public.listings where id = :'rascunho'), 'restrito ainda pode salvar rascunho');
:as_admin
select public.admin_commission_action(:'comm_livros', 'adjust', 'Desconto combinado', 500);
select test.ok((select amount_cents = 500 and original_amount_cents = 750 from public.commissions where id = :'comm_livros'), 'ajuste com justificativa preserva o valor original');
select public.admin_commission_action(:'comm_livros', 'confirm_paid');
:as_maria
select test.ok(not public.member_is_restricted(auth.uid()), 'pagamento confirmado libera novos anúncios');

-- ============================================================ moderação prévia
:as_admin
select public.admin_update_setting('moderation_mode', '"pre"');
:as_joao
insert into public.listings (category_id, title, asking_price_cents, condition, status) values ('roupas', 'Jaqueta de couro', 20000, 'seminovo', 'active') returning id as jaqueta \gset
select test.ok((select status = 'pending_review' from public.listings where id = :'jaqueta'), 'com moderação prévia, anúncio aguarda aprovação');
select test.fails(format($$update public.listings set status = 'active' where id = '%s'$$, :'jaqueta'), 'aguarda aprovação', 'vendedor não se autoaprova');
:as_pedro
select test.ok(test.n(format($$select count(*) from public.listings where id = '%s'$$, :'jaqueta')) = 0, 'anúncio em análise não aparece para outros');
:as_admin
select public.admin_moderate_listing(:'jaqueta', 'approve');
select test.ok((select status = 'active' from public.listings where id = :'jaqueta'), 'administrador aprova anúncio');
select public.admin_update_setting('moderation_mode', '"post"');
select test.fails($$select public.admin_set_user_role('a0000000-0000-0000-0000-000000000001', 'member')$$, 'pelo menos um', 'não remove o último administrador');

-- ============================================================ arquivos (políticas do storage)
:as_maria
insert into storage.objects (bucket_id, name) values ('receipts', :maria || '/pix.jpg');
select test.fails($$insert into storage.objects (bucket_id, name) values ('receipts', 'a0000000-0000-0000-0000-000000000003/pix.jpg')$$, 'row-level', 'não envia arquivo na pasta de outro membro');
:as_pedro
select test.ok(test.n($$select count(*) from storage.objects where bucket_id = 'receipts'$$) = 0, 'membro não abre comprovante de outro');
:as_admin
select test.ok(test.n($$select count(*) from storage.objects where bucket_id = 'receipts'$$) = 1, 'administrador abre comprovantes');

-- ============================================================ LGPD
:as_pedro
select public.delete_my_account();
select test.ok((select name = 'Membro removido' and account_status = 'deleted' from public.profiles where id = auth.uid()), 'exclusão de conta anonimiza o perfil');
select test.fails($$insert into public.listings (category_id, title, asking_price_cents, condition, status) values ('casa', 'Teste', 100, 'usado', 'draft')$$,
  'não está ativa', 'conta excluída não anuncia mais');
\o
reset role;
select 'ok - ' || count(*) || ' notificações geradas; ' || (select count(*) from public.audit_logs) || ' registros de auditoria' from public.notifications;
