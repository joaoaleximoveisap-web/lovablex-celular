# Robô do WhatsApp — seu assistente e o atendente das imobiliárias

Um número de WhatsApp só do robô (o chip novo). Ele faz três coisas:

1. **É o seu assistente.** Do seu WhatsApp pessoal, você escreve para o número do robô em português normal:
   - "salva a Carla da Imob Sol, 43 99999-1111, etiqueta imobiliária"
   - "toda segunda às 9h manda para as imobiliárias o resumo do radar"
   - "manda agora para a Carla e o Pedro: amanhã não vou conseguir passar aí"
   - "quais disparos estão agendados?" · "cancela o #k3f9a"
   - "como foi a conversa com a Carla?" · "pausa o robô para o Pedro, vou ligar para ele"
2. **Dispara mensagens agendadas** (uma vez, todo dia, toda semana ou todo mês), com o nome de cada pessoa e, se você quiser, o resumo atualizado do Radar Londrina.
3. **Responde os seus contatos** em seu nome: tira dúvidas com o que estiver em `conhecimento.md` e te avisa no seu WhatsApp quando alguém quer marcar reunião, falar de valores ou reclamar. Ele **não confirma reunião sozinho**: ele anota dois horários e te avisa.

Quem responder **SAIR** deixa de receber os disparos (e **VOLTAR** para voltar). Contato que escreve pela primeira vez é cadastrado com a etiqueta `novo` e você é avisado.

```
seu WhatsApp ─┐                         ┌─► Claude (o cérebro)
              ├─► número do robô ─► Meta ─► robô na Cloudflare ─┤
contatos ─────┘     (chip novo)          (grátis)               └─► banco de dados (contatos, agenda)
```

---

## Configuração (uma vez só, ~1 hora)

Dá para fazer tudo pelo navegador do celular, mas é mais confortável no computador.
Você vai juntar **8 secrets** e colar no GitHub. Anote cada um conforme for pegando.

### 1. O chip

- Ative o chip novo num celular qualquer só para **receber o SMS** de confirmação.
- **Não instale o WhatsApp nesse número.** Um número usado pela API oficial não pode estar no app. Se já estiver, apague a conta no app primeiro (WhatsApp → Configurações → Conta → Apagar conta).

### 2. Meta (a conta oficial do WhatsApp)

1. Entre em **developers.facebook.com** com o seu Facebook → **Meus apps → Criar app** → caso de uso **"Conectar-se com clientes pelo WhatsApp"** (ou tipo **Empresa**). Se pedir um portfólio empresarial, crie um com o nome do seu negócio.
2. No app, abra **WhatsApp → Configuração da API** (API Setup):
   - Clique em **Adicionar número de telefone**, coloque o chip novo, o nome que aparece para os contatos (ex.: "João Assessoria") e confirme com o SMS.
   - Copie o **Identificação do número de telefone** (Phone number ID) → secret `WHATSAPP_PHONE_ID`.
3. **Token permanente** (o token que aparece na tela expira em 24h, não use):
   - **business.facebook.com → Configurações → Usuários → Usuários do sistema → Adicionar** (função Administrador).
   - **Atribuir ativos** → o seu app (controle total) e a sua conta do WhatsApp (controle total).
   - **Gerar token** → escolha o app, validade **Nunca**, permissões `whatsapp_business_messaging` e `whatsapp_business_management` → secret `WHATSAPP_TOKEN`.
4. **Configurações do app → Básico → Chave secreta do app** (App Secret) → secret `WHATSAPP_APP_SECRET`.
5. Cadastre uma forma de pagamento na conta do WhatsApp (as mensagens que **você** inicia são cobradas pela Meta; responder quem te escreveu é grátis).

### 3. A mensagem-modelo "recado" (obrigatória para os disparos)

O WhatsApp só deixa mandar texto livre para quem te escreveu nas últimas 24 horas. Para o resto, a mensagem precisa ir num **modelo aprovado**. O robô usa um modelo só, com espaço para qualquer texto.

**WhatsApp Manager → Modelos de mensagem → Criar modelo**:

- Categoria: **Marketing** (novidades, convites, resumos) — se for só aviso operacional, **Utilidade**.
- Nome: `recado` · Idioma: **Português (BR)**
- Corpo:
  ```
  Olá, {{1}}! {{2}}

  Se não quiser mais receber estas mensagens, responda SAIR.
  ```
- Exemplos: `{{1}}` = `Carla` · `{{2}}` = `Saiu o resumo do Radar Londrina desta semana.`

A aprovação costuma sair em minutos. O robô também usa esse modelo para te avisar quando você não escreveu para ele nas últimas 24h.

### 4. Claude (o cérebro)

**console.anthropic.com → API Keys → Create Key** → secret `ANTHROPIC_API_KEY`. Coloque créditos em **Billing**. A chave da API é paga à parte, não vem da assinatura do app do Claude.

### 5. Cloudflare (onde o robô fica no ar, grátis)

1. Crie a conta em **dash.cloudflare.com**. Abra **Workers e Pages** uma vez e aceite o subdomínio `*.workers.dev` que ela sugerir.
2. Copie o **Account ID** (aparece na lateral da página inicial da conta) → secret `CLOUDFLARE_ACCOUNT_ID`.
3. **Meu perfil → Tokens de API → Criar token → modelo "Editar Cloudflare Workers"** → secret `CLOUDFLARE_API_TOKEN`.

### 6. Os outros dois secrets

- `WHATSAPP_VERIFY_TOKEN`: invente uma senha qualquer (ex.: `robo-joao-2026`). Você vai colar ela na Meta no passo 8.
- `DONO_NUMERO`: o **seu** WhatsApp pessoal, com DDD (ex.: `43988887777`). É assim que o robô sabe que é você.

### 7. Colar tudo no GitHub e publicar

1. GitHub → este repositório → **Settings → Secrets and variables → Actions → New repository secret**, um para cada:
   `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ANTHROPIC_API_KEY`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `DONO_NUMERO`.
2. **Actions → Robô do WhatsApp — publicar → Run workflow**.
3. Quando terminar, abra a execução: o resumo mostra o endereço do robô, algo como `https://lovablex-whatsapp.SEU-NOME.workers.dev`. Abra esse endereço: ele diz se falta algum secret.

### 8. Ligar a Meta no robô

No app da Meta: **WhatsApp → Configuração** (Configuration) → **Webhook → Editar**:

- URL de callback: `https://lovablex-whatsapp.SEU-NOME.workers.dev/webhook`
- Token de verificação: o mesmo `WHATSAPP_VERIFY_TOKEN`
- Depois, em **Campos do webhook**, assine **messages**.

Por fim, no topo do app, mude de **Desenvolvimento** para **Publicado** (Live). Sem isso, só números de teste recebem resposta.

### 9. Testar

Do seu WhatsApp pessoal, mande **"oi"** para o número do robô. Ele responde como seu assistente. Depois: *"salva meu contato de teste: Maria, 43 9xxxx-xxxx, etiqueta teste"* e *"manda agora para a etiqueta teste: olá {nome}, isto é um teste"*.

---

## No dia a dia

- **Ensinar o robô sobre o seu trabalho:** edite `whatsapp/conhecimento.md` (pode pedir pelo app LovableX: *"no conhecimento do robô do WhatsApp, acrescenta que eu atendo sábado de manhã"*). O robô é republicado sozinho.
  ⚠️ Se este repositório for público, esse arquivo também é: não ponha nele nada confidencial.
- **Contatos e agenda** ficam no banco do robô na Cloudflare, **não no GitHub**. Para mexer, fale com o robô.
- **Modelo do Claude:** em `wrangler.toml`, `MODELO = "claude-opus-5-5"` (o melhor). Para gastar menos, troque por `claude-sonnet-5-5` ou `claude-haiku-5-5` (bem mais barato).
- **Ver erros:** Cloudflare → Workers → lovablex-whatsapp → Logs.

## Limites desta primeira versão

- Lê só **texto**: áudio, foto e documento recebem um aviso pedindo texto, e você é avisado.
- Envia até **40 mensagens a cada 5 minutos** (~480 por hora). Listas maiores saem em lotes, sozinhas.
- Um disparo que atrasar mais de 6 horas (robô fora do ar) é pulado, para não chegar fora de hora.

## Regras do jogo (para não perder o número)

- Mande disparos **só para quem te conhece e aceitou receber**. Muitos bloqueios e denúncias derrubam a qualidade do número e a Meta limita ou bane.
- Comece com poucos contatos por dia. A Meta aumenta o seu limite de conversas aos poucos (começa em 250 pessoas por dia).
- LGPD: o robô respeita o SAIR automaticamente. Não importe listas compradas.

## Para quem for mexer no código

```
whatsapp/
  conhecimento.md   o que o robô sabe (texto livre)
  wrangler.toml     configuração da Cloudflare
  src/worker.js     entrada: webhook da Meta, disparos a cada 5 minutos
  src/agente.js     Claude, instruções e ferramentas (dono × contato)
  src/agenda.js     cálculo de quando cada agendamento sai
  src/dados.js      contatos, agenda, fila e conversas (Cloudflare KV)
  src/whatsapp.js   API oficial do WhatsApp (texto, template, assinatura)
  test/             npm test
```
