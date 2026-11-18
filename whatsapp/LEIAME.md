# Robô do WhatsApp — no seu próprio número

O robô usa o **seu WhatsApp Business**, conectado como se fosse um "WhatsApp Web" (QR code).
Você continua usando o celular normalmente. Ele faz três coisas:

1. **É o seu assistente.** Abra a conversa com você mesmo (**"Conversar comigo"**, o seu próprio
   nome na lista de contatos) e comece a mensagem com **"robô"**:
   - "robô, salva a Carla da Imob Sol, 43 99999-1111, etiqueta imobiliária"
   - "robô, toda segunda às 9h manda para as imobiliárias o resumo do radar"
   - "robô, manda agora para a Carla e o Pedro: amanhã não consigo passar aí"
   - "robô, quais disparos estão agendados?" · "cancela o #k3f9a"

   Por 10 minutos depois disso, não precisa repetir "robô". As respostas dele começam com 🤖.
   O que você escrever ali **sem** "robô" (as suas anotações) ele ignora.
2. **Dispara mensagens agendadas** (uma vez, todo dia, toda semana ou todo mês), com o nome de cada pessoa
   e, se você quiser, o resumo atualizado do Radar Londrina.
3. **Responde os contatos que você cadastrou** (imobiliárias, corretores). Ele tira dúvidas com o que estiver
   em `conhecimento.md` e, quando alguém quer reunião, valores ou reclamar, deixa um recado 🔔 no seu
   "Conversar comigo". Ele **não confirma reunião sozinho**.

### O que ele nunca faz

- **Não responde quem não está cadastrado**: família, amigos, clientes antigos, grupos. Para ele, essas conversas não existem.
- **Não atrapalha você**: se você mesmo responde um contato, ele fica quieto com aquela pessoa por 12 horas.
- **Não dispara à noite nem em rajada**: só entre 8h e 20h, 4 mensagens a cada 5 minutos, com "digitando…"
  e intervalo entre uma e outra, no máximo 80 por dia. Tudo isso é ajustável em `wrangler.toml`.
- Quem responde **SAIR** não recebe mais disparos (e **VOLTAR** para voltar).

## ⚠️ O risco, em uma frase

Conectar por QR code **não é permitido pela Meta**. Se muita gente bloquear ou denunciar as suas mensagens,
a Meta pode **banir o seu número**. Os limites acima reduzem o risco, mas não zeram.
Para diminuir ainda mais: mande só para quem te conhece, comece com poucas pessoas por dia e não mande o mesmo texto para todo mundo.

```
seu celular (WhatsApp Business) ── QR code ──► Evolution (seu servidor)
                                                    │  webhook
                                                    ▼
                                     robô na Cloudflare (grátis) ──► Claude (o cérebro)
                                                    │
                                                    └─► banco: contatos, agenda, conversas
```

---

## Configuração (uma vez só)

### 1. Um servidor para o Evolution (~R$ 25–40/mês)

O Evolution precisa ficar ligado 24h, conectado ao seu WhatsApp. A Cloudflare grátis não serve para isso.

**Caminho mais fácil:** contrate uma VPS com o **EasyPanel** (a Hostinger oferece pronto, por exemplo) e instale o
modelo **"Evolution API"** com um clique. Ele já dá um endereço https. Anote:
- o endereço (ex.: `https://evolution.seuservidor.com`) → secret `EVOLUTION_URL`
- a **API key global** que você definir na instalação → secret `EVOLUTION_API_KEY`

**Caminho manual (qualquer VPS com Docker):** copie a pasta `whatsapp/servidor/` para o servidor,
faça `cp .env.exemplo .env`, preencha o arquivo e rode `docker compose up -d`. O endereço é `https://` + `ENDERECO`,
e a chave é o `AUTHENTICATION_API_KEY`.

### 2. Conectar o seu WhatsApp

1. Abra `EVOLUTION_URL/manager` e entre com a API key.
2. **Criar instância** com o nome **`joao`**, canal Baileys / WhatsApp.
3. Aparece um QR code. No celular: **WhatsApp Business → ⋮ (ou Configurações) → Dispositivos conectados → Conectar dispositivo** → leia o QR.

Pronto: o Evolution aparece como um "computador conectado". Se um dia você desconectar por ali, o robô para.

### 3. Claude (o cérebro)

**console.anthropic.com → API Keys → Create Key** → secret `ANTHROPIC_API_KEY`. Coloque créditos em **Billing**.
É pago à parte da assinatura do app do Claude.

### 4. Cloudflare (onde o robô fica, grátis)

1. Crie a conta em **dash.cloudflare.com**. Abra **Workers e Pages** uma vez e aceite o subdomínio `*.workers.dev`.
2. Copie o **Account ID** → secret `CLOUDFLARE_ACCOUNT_ID`.
3. **Meu perfil → Tokens de API → Criar token → modelo "Editar Cloudflare Workers"** → secret `CLOUDFLARE_API_TOKEN`.

### 5. Os dois últimos secrets

- `WEBHOOK_SEGREDO`: invente uma senha só com letras e números (ex.: `k8Jq2xVb7mPz`). Ela vai no endereço do webhook,
  e assim ninguém mais consegue mandar mensagens falsas para o robô.
- `DONO_NUMERO`: o seu número, com DDD (ex.: `43988887777`).

### 6. Colar tudo no GitHub e publicar

1. GitHub → este repositório → **Settings → Secrets and variables → Actions → New repository secret**, um para cada:
   `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ANTHROPIC_API_KEY`, `EVOLUTION_URL`, `EVOLUTION_API_KEY`,
   `WEBHOOK_SEGREDO`, `DONO_NUMERO`.
2. **Actions → Robô do WhatsApp — publicar → Run workflow**.
3. No resumo da execução aparece o endereço do robô, algo como `https://lovablex-whatsapp.SEU-NOME.workers.dev`.
   Abra esse endereço: ele diz se falta algum secret.

### 7. Ligar o Evolution no robô

No `/manager` do Evolution → instância **joao** → **Eventos → Webhook**:
- **Ativado**
- URL: `https://lovablex-whatsapp.SEU-NOME.workers.dev/evolution/SEU_WEBHOOK_SEGREDO`
- **Webhook by events**: desligado · **Webhook base64**: desligado
- Eventos: marque **MESSAGES_UPSERT**
- Salvar.

### 8. Testar

1. No WhatsApp, abra a conversa com **você mesmo** e escreva: **robô, oi**. A resposta deve chegar com 🤖.
2. **robô, salva meu contato de teste: Maria, 43 9xxxx-xxxx, etiqueta teste** (use o número de alguém de confiança).
3. **robô, manda agora para a etiqueta teste: olá {nome}, isto é um teste** (sai em até 5 minutos, se for entre 8h e 20h).
4. Peça para a Maria responder e veja o robô conversar com ela.

---

## No dia a dia

- **Ensinar o robô sobre o seu trabalho:** edite `whatsapp/conhecimento.md`. Pode pedir pelo app LovableX, por exemplo:
  *"no conhecimento do robô do WhatsApp, acrescenta que eu atendo sábado de manhã"*. O robô é republicado sozinho.
  ⚠️ Se este repositório for público, esse arquivo também é: não ponha nada confidencial nele.
- **Contatos e agenda** ficam no banco do robô na Cloudflare, **não no GitHub**. Para mexer, fale com o robô.
- **Só disparos, sem respostas automáticas:** em `wrangler.toml`, `AUTO_RESPOSTA = "nao"`.
- **Gastar menos com o Claude:** em `wrangler.toml`, troque `MODELO = "claude-opus-5-5"` por `claude-sonnet-5-5` ou `claude-haiku-5-5`.
- **Ver erros:** Cloudflare → Workers → lovablex-whatsapp → Logs.

## Limites desta versão

- Lê só **texto**. Áudio, foto e documento ficam para você responder.
- Os recados 🔔 chegam no "Conversar comigo", que **não toca notificação**. Mas a mensagem do próprio contato toca, então você vê de qualquer jeito.
- Não participa de grupos.

## Para quem for mexer no código

```
whatsapp/
  conhecimento.md     o que o robô sabe (texto livre)
  wrangler.toml       configuração e limites
  servidor/           docker-compose do Evolution API (opcional)
  src/worker.js       entrada: webhook do Evolution, disparos a cada 5 minutos, regras de quem responder
  src/agente.js       Claude, instruções e ferramentas (dono × contato)
  src/agenda.js       cálculo de quando cada agendamento sai
  src/dados.js        contatos, agenda, fila e conversas (Cloudflare KV)
  src/evolution.js    envio pelo Evolution e leitura do webhook
  test/               npm test
```
