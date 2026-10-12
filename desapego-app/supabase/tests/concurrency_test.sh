#!/usr/bin/env bash
# Duas confirmações de venda chegando juntas para o mesmo anúncio: só uma pode valer.
set -euo pipefail
PSQL="psql -X -q -t -A -v ON_ERROR_STOP=1"
MARIA='{"sub":"a0000000-0000-0000-0000-000000000002"}'
AS_MARIA="set role authenticated; set request.jwt.claims = '$MARIA';"
LISTING=$($PSQL <<<"$AS_MARIA
insert into public.listings (category_id, title, asking_price_cents, condition, status) values ('casa', 'Geladeira', 120000, 'usado', 'active') returning id;" | tail -1)
run() {
  $PSQL <<<"$AS_MARIA
select public.mark_listing_sold('$LISTING', $1, 'venda', null, null, null, gen_random_uuid());" >/dev/null 2>&1 && echo ok || echo bloqueada
}
OUT=$(mktemp -d)
run 110000 >"$OUT/a" & run 115000 >"$OUT/b" & run 118000 >"$OUT/c" & wait
SALES=$($PSQL -c "select count(*) from public.sales where listing_id = '$LISTING' and completion_status = 'completed'")
COMMS=$($PSQL -c "select count(*) from public.commissions c join public.sales s on s.id = c.sale_id where s.listing_id = '$LISTING'")
echo "   tentativas: $(cat "$OUT"/a "$OUT"/b "$OUT"/c | tr '\n' ' ')"
rm -rf "$OUT"
if [ "$SALES" = "1" ] && [ "$COMMS" = "1" ]; then
  echo "ok - 3 confirmações simultâneas: 1 venda e 1 comissão registradas"
else
  echo "FALHOU: vendas simultâneas geraram $SALES vendas e $COMMS comissões"; exit 1
fi
