# ARMÁRIO — Guarda-Roupa Inteligente

> “Descubra novas formas de se vestir com as roupas que você já tem.”

Aplicativo nº 1 da lista de prioridades. PWA instalável que funciona **sem IA, sem API externa,
sem banco de dados online, sem login e sem internet** depois de instalado.

**Endereço:** `/armario/` (ex.: `https://joaoaleximoveisap-web.github.io/lovablex-celular/armario/`)

---

## O que está pronto

| Tela | O que faz |
|---|---|
| **Início** | Look sugerido do dia (estável durante o dia), números do armário, quantos looks bons existem por ocasião |
| **Peças** | Catálogo em grade, filtros por vaga e por situação, detalhe, edição, favoritar, marcar lavando, excluir |
| **Montar** | Escolha de ocasião + clima → até 6 combinações ordenadas por nota, com troca de peça por vaga |
| **Salvos** | Favoritos e histórico de uso |
| **Ajustes** | Preferências do motor, backup, explicação das regras, instalação, apagar tudo |

Extras: cartão do look em PNG (compartilhar ou baixar), montar looks a partir de uma peça
específica, aviso de peça exigida que está indisponível.

## Como ele decide (nenhuma IA)

Cada combinação recebe uma nota de 0 a 100 somando cinco critérios:

| Critério | Peso | O que mede |
|---|---|---|
| Cores | 34% | Compatibilidade entre as cores cadastradas: ~60 pares clássicos e ~12 atritos conhecidos, mais regras por família e vivacidade. Penaliza dois padrões no mesmo look |
| Ocasião | 30% | Distância entre a formalidade do look e a formalidade típica da ocasião |
| Coerência | 14% | Penaliza peças de níveis muito distantes entre si |
| Clima | 16% | Estações marcadas em cada peça + necessidade (ou proibição) de camada |
| Novidade | 6% | Evita repetir peças usadas nos últimos dias |

Favoritas ganham um bônus de até 7,5%. O calçado pesa 1,4× na formalidade do look porque é o que
mais define o nível de uma produção.

**Regras rígidas** (eliminam a peça antes da pontuação): lavando ou indisponível; peça só de frio
em dia de calor (e vice-versa); sandália em ocasião de calçado fechado; bermuda em trabalho,
jantar ou evento; camada em dia de calor.

O app **não reconhece a foto**: os dados vêm do cadastro. Também não consulta previsão do tempo —
o clima é informado em um toque.

## Arquitetura

- **Um arquivo**: `index.html` (~110 KB) com HTML, CSS e JavaScript. Sem build, sem dependências,
  sem CDN — mesmo padrão do `radar/` deste repositório.
- **Dados**: IndexedDB (`armario`), três coleções — `pecas`, `looks`, `config`.
- **Fotos**: comprimidas no próprio aparelho via canvas (WebP quando disponível), em duas versões —
  900 px para o detalhe e 320 px para as grades. Ficam como Blob no IndexedDB, nunca saem do aparelho.
- **Offline**: `sw.js` guarda a casca do app (rede primeiro, cache como reserva).
- **Backup**: JSON com as fotos embutidas em base64; a importação repõe tudo.

## Limites conhecidos (ditos ao usuário dentro do app)

- Limpar os dados do navegador, desinstalar ou trocar de aparelho apaga tudo. Por isso o backup
  existe e o app oferece `navigator.storage.persist()`.
- Não há sincronização entre aparelhos nem cópia em servidor.
- Lembretes com o app fechado exigiriam infraestrutura adicional — o app não promete isso.
- **Cobrança e liberação de acesso não devem ser feitas com senha no JavaScript**: qualquer código
  embutido pode ser contornado. Venda em plataforma separada e entregue o app depois da compra.

## Publicar

O repositório já serve arquivos estáticos. Basta a pasta `armario/` estar no branch publicado:
`index.html`, `manifest.webmanifest`, `sw.js` e `marca/`.

Ao subir uma versão nova, incremente `CACHE` em `sw.js` (`armario-v1` → `armario-v2`) para que os
aparelhos já instalados peguem a atualização.

## Testado

Chromium 390×844, com e sem fotos: cadastro pela interface, catálogo e filtros, 12 combinações de
ocasião × clima, troca de vaga, salvar, registrar uso, cartão PNG, backup exportar → apagar tudo →
importar, instalação do service worker e abertura **offline**. Armário de 120 peças: tela inicial
completa em ~0,6 s; montagem de looks em 30–90 ms por ocasião.

## Próximos passos sugeridos

1. Planejamento semanal (segunda a domingo) reaproveitando o motor.
2. Estatísticas de uso: peças paradas há mais de 90 dias, custo por uso.
3. Compartilhar a mesma base de código com **HOJE** e **EDIT**, como três produtos comerciais.
