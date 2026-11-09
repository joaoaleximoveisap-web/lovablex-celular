# 🚀 PROMPT MESTRE — Crie qualquer aplicativo PWA

> **Como usar:** copie tudo que está dentro do bloco abaixo, cole no Lovable / Claude / ChatGPT / Bolt / v0
> e troque **apenas** a primeira linha pela sua ideia. O resto já garante um app bonito, rápido e fácil.

---

```text
MINHA IDEIA: Tenho a ideia de criar um aplicativo para [DESCREVA SUA IDEIA AQUI EM 1 OU 2 FRASES].

Você é um time completo: designer de produto sênior (nível Apple/Linear/Stripe), especialista em UX
e engenheiro front-end. Transforme a ideia acima em um APLICATIVO PWA COMPLETO, FUNCIONANDO e PRONTO
PARA USAR no celular. Não me faça perguntas: tome as melhores decisões sozinho e entregue o app.

═══════════════════════════════════════
1. REGRA DE OURO — "ENTENDE EM 3 SEGUNDOS"
═══════════════════════════════════════
- Qualquer pessoa abre o app e em 3 segundos sabe: O QUE é, O QUE fazer e ONDE tocar.
- A tela inicial mostra a informação mais importante GRANDE, no topo (número/status principal).
- Uma ação principal por tela, com um botão grande e óbvio (botão flutuante "+" quando fizer sentido).
- Zero jargão. Textos curtos (máx. 6 palavras em títulos). Ícone + palavra em todo botão.
- No máximo 4 abas na barra inferior. Tudo a no máximo 2 toques de distância.
- Estados vazios amigáveis: ilustração/emoji + frase curta + botão "Começar".
- Já venha com DADOS DE EXEMPLO realistas para o app parecer vivo na primeira abertura
  (com opção "Limpar dados de exemplo").

═══════════════════════════════════════
2. VISUAL — ESTILO CARDS COM TOQUE 3D
═══════════════════════════════════════
- Layout em CARDS: cantos bem arredondados (20–24px), espaçamento generoso, sombras suaves em camadas.
- Profundidade 3D sutil e elegante:
  • cards com leve inclinação (tilt) ao tocar/arrastar usando transform: perspective() rotateX/rotateY;
  • efeito de vidro (glassmorphism: backdrop-filter blur + borda translúcida) no cabeçalho e na barra inferior;
  • gradientes suaves e um brilho de luz que acompanha o dedo/mouse no card principal;
  • 1 elemento "hero" 3D na tela inicial (ex.: anel de progresso com volume, moeda/esfera/ícone 3D
    em CSS ou Three.js leve) — só se combinar com a ideia, sem exagero.
- Paleta: 1 cor principal vibrante + neutros. Cores de status: verde (bom), âmbar (atenção), vermelho (problema).
- Tipografia: Inter (ou system-ui). Números grandes e em negrito. Hierarquia clara.
- MODO CLARO E ESCURO automático (prefers-color-scheme) + botão para alternar.
- Ícones: Lucide (traço consistente). Nada de emoji como ícone de navegação.

═══════════════════════════════════════
3. GRÁFICOS — SÓ SE AJUDAR A ENTENDER
═══════════════════════════════════════
- Se a ideia envolve números, progresso, tempo, dinheiro, metas ou comparação: inclua gráficos.
- Use o gráfico CERTO: linha = evolução no tempo; barras = comparar; rosca/anel = parte do todo/meta;
  sparkline = mini tendência dentro do card.
- Cards de KPI no topo: número grande + variação (▲ +12% verde / ▼ −5% vermelho) + sparkline.
- Gráficos animados ao aparecer, com toque para ver o valor (tooltip), legíveis no celular,
  sem poluição (sem grades pesadas, máx. 4 cores).
- Filtro de período simples em pílulas: "7d · 30d · 12m".
- Biblioteca: Recharts (React) ou Chart.js. Se não houver números na ideia, NÃO force gráfico.

═══════════════════════════════════════
4. FLUIDEZ E MICROINTERAÇÕES
═══════════════════════════════════════
- Animações a 60fps usando só transform e opacity (Framer Motion se for React).
- Transições entre telas deslizando; cards entram em cascata (stagger) de 40ms.
- Feedback em TODO toque: botão "afunda" (scale 0.96), vibração leve (navigator.vibrate) em ações importantes.
- Gestos: puxar para atualizar, deslizar card para o lado para excluir/concluir (com "Desfazer").
- Skeleton loading (nunca tela branca, nunca spinner sozinho).
- Toasts curtos de confirmação ("Salvo ✓").
- Respeite prefers-reduced-motion (desliga efeitos 3D e animações para quem pedir).

═══════════════════════════════════════
5. PWA DE VERDADE — RÁPIDO E INSTALÁVEL
═══════════════════════════════════════
- manifest.webmanifest completo (nome, short_name, ícones 192/512 e maskable, theme_color,
  background_color, display: standalone, orientation: portrait).
- Service Worker com cache offline: o app abre e funciona SEM INTERNET.
- Botão/banner "Instalar app" (evento beforeinstallprompt) e instrução para iPhone
  ("Compartilhar → Adicionar à Tela de Início").
- Dados salvos localmente (localStorage/IndexedDB) — nada se perde ao fechar.
- Exportar/importar dados em JSON (backup) nas Configurações.
- Performance: carregamento inicial < 2s em 4G, Lighthouse ≥ 90 em todas as categorias,
  imagens otimizadas, lazy loading, sem bibliotecas pesadas desnecessárias.

═══════════════════════════════════════
6. RESPONSIVO E ACESSÍVEL
═══════════════════════════════════════
- Mobile-first (base 375px), perfeito também em tablet e desktop (no desktop: cards em grade de 2–3 colunas
  e navegação lateral).
- Áreas de toque ≥ 44px. Respeitar notch/safe-area (env(safe-area-inset-*)).
- Contraste AA, textos ≥ 16px, labels em todos os campos, navegação por teclado, aria-labels nos ícones.
- Formulários curtos: teclado certo por campo (numérico, e-mail, data), valores padrão inteligentes,
  validação amigável em tempo real.

═══════════════════════════════════════
7. ESTRUTURA QUE VOCÊ DEVE GERAR
═══════════════════════════════════════
Antes de codar, defina em poucas linhas (e depois siga):
  a) Nome curto e marcante do app + slogan de 5 palavras.
  b) As 3 funções principais (o essencial, sem inchar).
  c) As telas (máx. 5): normalmente Início (painel com cards + gráfico), Lista/Itens, Adicionar,
     Detalhe e Configurações.
Depois entregue o app completo com:
  - Onboarding de no máximo 3 telas deslizáveis (pulável) explicando o app com ícones grandes.
  - Tela Início = painel: saudação + card principal 3D com o número mais importante + KPIs + gráfico
    + lista dos itens recentes.
  - CRUD completo (criar, ver, editar, excluir com desfazer), busca e filtros em pílulas.
  - Configurações: tema, exportar/importar, limpar dados, sobre.

═══════════════════════════════════════
8. TECNOLOGIA
═══════════════════════════════════════
- Preferência: React + Vite + TypeScript + Tailwind CSS + Framer Motion + Recharts + Lucide.
- Se o ambiente pedir arquivo único: HTML + CSS + JavaScript puro, tudo em um index.html,
  mais manifest.webmanifest e sw.js.
- Código limpo, componentizado, sem erros no console, sem placeholders "TODO" e sem "lorem ipsum".

═══════════════════════════════════════
9. CHECKLIST FINAL (confira antes de entregar)
═══════════════════════════════════════
[ ] Entendo o app em 3 segundos olhando a tela inicial?
[ ] Funciona offline e é instalável?
[ ] Fica lindo no celular, no claro e no escuro?
[ ] Todas as animações estão suaves e nada trava?
[ ] Gráfico (se houver) é claro e útil?
[ ] Todos os botões funcionam e os dados ficam salvos?
Se algum item falhar, corrija antes de responder.

Entregue o app funcionando. No final, em 5 linhas, diga: o que foi criado, como instalar no celular
e 3 ideias de melhoria para a próxima versão.
```

---

## 💡 Exemplos de primeira linha

- *Tenho a ideia de criar um aplicativo para controlar meus gastos do mês e saber quanto ainda posso gastar.*
- *Tenho a ideia de criar um aplicativo para corretores de imóveis acompanharem visitas e clientes.*
- *Tenho a ideia de criar um aplicativo para lembrar de beber água e ver meu progresso da semana.*
- *Tenho a ideia de criar um aplicativo para uma academia marcar treinos e ver a evolução de carga.*
- *Tenho a ideia de criar um aplicativo para organizar os pedidos da minha loja de doces.*

## 🔧 Ajustes rápidos (cole no final, se quiser)

- **Cor da marca:** `Use como cor principal #XXXXXX.`
- **Sem 3D:** `Mantenha o visual em cards, mas sem efeitos 3D.`
- **Com login/nuvem:** `Adicione login e salve os dados no Supabase.`
- **Público idoso:** `Textos e botões 30% maiores, máximo de 3 opções por tela.`
