# Desapego da Família

Marketplace particular para familiares e convidados: anunciar, negociar, vender, trocar ou doar. O administrador recebe uma comissão sobre as vendas concluídas.

- **Código-fonte:** `desapego-app/` (React + TypeScript + Vite + Tailwind)
- **App publicado (build):** `desapego/`, servido pelo GitHub Pages em `…/lovablex-celular/desapego/`
- **Banco:** `desapego-app/supabase/migrations/` (PostgreSQL / Supabase)

## Como colocar no ar (passo a passo)

### 1. Criar o banco (Supabase, plano gratuito)

1. Crie um projeto em <https://supabase.com> (região São Paulo, de preferência).
2. Abra **SQL Editor** e rode os arquivos de `supabase/migrations/` **nesta ordem**, um de cada vez:
   1. `20261012000100_schema.sql`
   2. `20261012000200_functions.sql`
   3. `20261012000300_security.sql`
   4. `20261012000400_storage.sql`

   Também dá para usar a CLI: `supabase link --project-ref <ref>` e depois `supabase db push`.
3. Em **Authentication → URL Configuration**:
   - **Site URL:** o endereço do app, por exemplo `https://joaoaleximoveisap-web.github.io/lovablex-celular/desapego/`
   - **Redirect URLs:** o mesmo endereço.
4. Em **Authentication → Providers → Email**, deixe *Enable sign ups* **ligado**. O próprio banco recusa cadastros sem convite válido. *Confirm email* pode ficar ligado (mais seguro) ou desligado (mais simples para a família).
5. **Crie o seu acesso de administrador:** no SQL Editor, rode

   ```sql
   select public.create_owner_invite();
   ```

   O resultado é um código (ex.: `AB12-CD34-EF56`), válido por 2 dias e para uma única pessoa. Ele só pode ser criado pelo SQL Editor, nunca pelo app.

### 2. Ligar o app ao banco

Edite `desapego/config.js` (o app publicado) e `desapego-app/public/config.js` (o código-fonte) com os dados de **Project Settings → API**:

```js
window.DESAPEGO_CONFIG = {
  supabaseUrl: "https://SEU-PROJETO.supabase.co",
  supabaseAnonKey: "sua anon public key",
};
```

A chave *anon* é pública por natureza; quem protege os dados são as regras do banco. **Nunca** use a chave `service_role`.

### 3. Publicar

O GitHub Pages deste repositório publica a branch `main`. Depois que esta branch for integrada à `main`, o app fica em:

`https://joaoaleximoveisap-web.github.io/lovablex-celular/desapego/`

Abra `…/desapego/#/cadastro?convite=SEU-CODIGO`, crie sua conta e pronto: você é o administrador. Depois:

1. **Painel → Configurações:** chave Pix, nome do recebedor, cidade e percentual. Leia o QR de teste com o app do banco para conferir.
2. **Painel → Usuários:** gere convites e envie pelo WhatsApp.

O build também funciona em qualquer hospedagem estática (Netlify, Vercel, Cloudflare Pages), sem nenhuma configuração de rotas (o app usa rotas com `#`).

## Desenvolvimento

```bash
cd desapego-app
npm install
npm run dev          # servidor local
npm test             # testes de cálculo (comissão, valores, Pix)
npm run test:db      # sobe um PostgreSQL 16 temporário e testa regras e permissões
npm run build        # verifica tipos e gera ../desapego
node scripts/ui-check.mjs /tmp/telas   # abre 17 telas em celular, iPad e computador (API simulada)
```

`test:db` precisa dos binários do PostgreSQL 16 (`/usr/lib/postgresql/16/bin` ou a variável `PGBIN`).

## Arquitetura e decisões

| Decisão | Motivo |
|---|---|
| Supabase (Postgres + Auth + Storage + Realtime) | Tem plano gratuito, autenticação pronta e RLS no próprio banco. Não há servidor para manter. |
| Regras críticas em funções SQL (`security definer`) | Venda, comissão, propostas e administração são conferidas e gravadas numa única transação no servidor; o app não consegue burlar nada. |
| GRANT por coluna + RLS em todas as tabelas | Mesmo com a chave pública, um membro só lê e altera o que é dele, e somente nas colunas permitidas. |
| Dinheiro em centavos (`bigint`) e taxa em pontos-base (500 = 5%) | Evita erros de arredondamento. Comissão = `(preço × taxa + 5000) / 10000`. |
| Taxa congelada na venda (`commission_rate_snapshot`) | Mudar o percentual nunca altera vendas já registradas. |
| "Em atraso" calculado na consulta (`commissions_view`) | Dispensa tarefas agendadas (custo zero). O lembrete é criado quando o vendedor abre o app. |
| Fotos comprimidas no aparelho (1600 px + miniatura 600 px, WebP) | Economiza dados e armazenamento; a vitrine carrega só miniaturas. |
| `HashRouter` (`#/rota`) | Atualizar a página em qualquer tela funciona no GitHub Pages sem truques. |
| `config.js` lido em tempo de execução | Trocar o projeto Supabase não exige recompilar. |
| PWA com `registerType: prompt` | Funciona instalado; versão nova só entra quando a pessoa toca em "Atualizar". O cache guarda só a "casca" e as fotos, nunca mensagens ou pagamentos. |
| PDF pela janela de impressão do navegador | Exportação sem biblioteca extra. |

### Banco de dados

Tabelas: `profiles`, `profile_private` (telefone, nunca público), `invites` (código guardado como hash SHA-256), `categories`, `listings`, `listing_images`, `favorites`, `user_blocks`, `conversations`, `messages`, `offers`, `sales`, `commissions`, `payment_reports`, `notifications`, `reports`, `app_settings`, `audit_logs`.

Principais funções chamadas pelo app: `search_listings`, `start_conversation`, `make_offer`, `respond_offer`, `cancel_offer`, `mark_listing_sold`, `confirm_purchase`, `cancel_sale`, `report_payment`, `sync_my_reminders`, `admin_*` (painel), `delete_my_account` (LGPD).

### Fluxo do dinheiro

1. **Publicar, receber ou aceitar proposta:** nada é cobrado.
2. **Marcar como vendido** (com o valor real): cria `sales` e, se for venda com valor, `commissions` com o status `awaiting_payment` e vencimento configurável.
3. **Vendedor paga o Pix e toca em "Já paguei":** `payment_reported`. Isso **não** conta como recebido.
4. **Administrador confere no banco e confirma:** `paid`. Só então o valor entra em "Recebido de fato".
5. **Atraso:** lembrete automático ao abrir o app. Depois do prazo de tolerância contado a partir do aviso, novos anúncios ficam bloqueados até a regularização.
6. **Doação, troca sem dinheiro e venda cancelada:** comissão zero.

## Limitações reais

- **Vendas fora do app:** não há como detectar sozinho uma venda combinada por WhatsApp e paga diretamente. O app depende da declaração do vendedor, com confirmação opcional do comprador, termos aceitos no cadastro e lembretes.
- **Pix:** o app gera o "copia e cola" e o QR Code estático com o valor (padrão do Banco Central, testado com o exemplo oficial). Não há integração bancária, então o recebimento é sempre confirmado manualmente pelo administrador.
- **Fotos dos anúncios** ficam num bucket de leitura pública, com caminhos aleatórios. Quem tiver o link exato da foto consegue abri-la. Comprovantes ficam em bucket privado.
- **Notificações push** (com o app fechado) não foram implementadas. Há notificações internas em tempo real, e a estrutura `notifications` está pronta para isso.
- **Exclusão total do login:** `delete_my_account` anonimiza o perfil. Para apagar também o registro de autenticação, o administrador remove o usuário em *Authentication → Users*, mas apenas para contas sem vendas registradas (os registros financeiros são mantidos).
- **Termos e política de privacidade** são textos-base e devem passar por revisão jurídica antes do uso comercial.
- **Moderadores:** o papel existe no banco (`moderator`) e nas regras de leitura, mas ainda não pode ser atribuído pelo painel.

## Custos

- Supabase gratuito: 500 MB de banco, 1 GB de arquivos e 50 mil usuários ativos por mês. Projetos gratuitos **pausam após 7 dias sem uso** e são reativados pelo painel. Para evitar isso, o plano Pro custa US$ 25/mês.
- GitHub Pages: gratuito.
- Nenhuma API paga, SMS ou serviço de terceiros.
