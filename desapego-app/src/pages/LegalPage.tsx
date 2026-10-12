import { Link, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { formatRate } from "@/lib/money";

function H({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 mt-7 text-lg font-extrabold text-ink">{children}</h2>;
}
function P({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-[15.5px] leading-relaxed text-ink/85">{children}</p>;
}
function Li({ children }: { children: ReactNode }) {
  return <li className="mb-1.5 text-[15.5px] leading-relaxed text-ink/85">{children}</li>;
}

function Terms({ rate, due, grace }: { rate: string; due: number; grace: number }) {
  return (
    <>
      <P>Estes termos valem para todas as pessoas que participam do Desapego da Família, uma comunidade privada de compra, venda, troca e doação de produtos entre familiares e convidados.</P>
      <H>1. Participação</H>
      <P>A entrada é feita por convite ou código de acesso fornecido pelo administrador. Cada pessoa é responsável pelas informações da sua conta e por manter a senha em segurança. O administrador pode aprovar, suspender ou encerrar contas que descumpram estas regras.</P>
      <H>2. Anúncios</H>
      <ul className="mb-3 list-disc pl-5">
        <Li>Anunciar é gratuito. Não existe cobrança por anúncios não vendidos.</Li>
        <Li>O anunciante declara ser dono do produto e descreve seu estado com honestidade, com fotos reais.</Li>
        <Li>É proibido anunciar produtos ilegais, roubados, falsificados, armas, munições, medicamentos, bebidas alcoólicas para menores, animais silvestres ou qualquer item cuja venda exija autorização específica.</Li>
        <Li>O administrador pode remover ou suspender anúncios que violem estas regras.</Li>
      </ul>
      <H>3. Negociação e pagamento entre membros</H>
      <P>Comprador e vendedor negociam livremente o preço, a entrega e a forma de pagamento. O pagamento do produto é feito diretamente entre as pessoas, fora do aplicativo. O aplicativo não guarda, não intermedeia e não garante o dinheiro da venda, e não se responsabiliza pela qualidade, entrega ou pagamento dos produtos negociados. Uma proposta aceita no app não significa que a venda foi paga ou concluída.</P>
      <H>4. Comissão sobre vendas concluídas</H>
      <ul className="mb-3 list-disc pl-5">
        <Li>Quando uma venda é concluída, o vendedor deve registrá-la no app com o valor real negociado (“Marcar como vendido”). Isso vale também para vendas combinadas por WhatsApp ou pessoalmente com alguém que conheceu o produto pelo app.</Li>
        <Li>A comissão atual é de {rate} sobre o valor da venda, de responsabilidade do vendedor, paga ao administrador por Pix em até {due} dias.</Li>
        <Li>A taxa fica registrada no momento da venda e não muda depois, mesmo que o percentual geral seja alterado.</Li>
        <Li>Doações e trocas sem pagamento em dinheiro não pagam comissão. Negociações canceladas não geram comissão.</Li>
        <Li>O pagamento só é considerado recebido depois da conferência do administrador. Informar o pagamento no app não equivale a confirmação.</Li>
        <Li>O administrador pode conceder isenções ou ajustar valores, sempre com justificativa registrada.</Li>
        <Li>Comissões vencidas geram um aviso. Se não forem regularizadas em {grace} dias após o aviso, a publicação de novos anúncios fica bloqueada até a regularização.</Li>
      </ul>
      <H>5. Convivência</H>
      <P>Seja respeitoso nas conversas. Não envie spam, ofensas ou conteúdo impróprio. Use os botões de bloquear e denunciar quando necessário.</P>
      <H>6. Conflitos</H>
      <P>Divergências sobre vendas e comissões podem ser registradas pelo próprio app (contestação ou denúncia) e serão analisadas pelo administrador. Questões sobre o produto e o pagamento entre comprador e vendedor devem ser resolvidas entre as partes.</P>
      <H>7. Alterações</H>
      <P>Estes termos podem ser atualizados. Mudanças na comissão valem apenas para vendas registradas depois da alteração.</P>
    </>
  );
}

function Privacy() {
  return (
    <>
      <P>Esta política explica como tratamos seus dados pessoais, de acordo com a Lei Geral de Proteção de Dados (Lei 13.709/2018).</P>
      <H>Quais dados guardamos</H>
      <ul className="mb-3 list-disc pl-5">
        <Li>Cadastro: nome, e-mail, senha (guardada de forma criptografada pelo serviço de autenticação), foto e cidade ou bairro, se você informar.</Li>
        <Li>Telefone: opcional e privado. Só é mostrado a outra pessoa se você tocar em “Enviar meu WhatsApp” numa conversa.</Li>
        <Li>Atividade: anúncios, fotos, mensagens, propostas, vendas declaradas, comissões e comprovantes de pagamento.</Li>
      </ul>
      <H>Para que usamos</H>
      <P>Para funcionar o marketplace (mostrar anúncios, permitir conversas e propostas), registrar vendas e cobrar a comissão combinada nos termos, prevenir abusos e cumprir obrigações legais.</P>
      <H>Quem vê o quê</H>
      <ul className="mb-3 list-disc pl-5">
        <Li>Membros da comunidade veem seu nome, foto, cidade/bairro e seus anúncios públicos.</Li>
        <Li>Mensagens privadas são visíveis apenas para as duas pessoas da conversa. O administrador não tem acesso a elas.</Li>
        <Li>Suas vendas, comissões e comprovantes são visíveis apenas para você e o administrador. Outros membros nunca veem seus dados financeiros.</Li>
        <Li>Não vendemos nem compartilhamos seus dados com terceiros para publicidade.</Li>
      </ul>
      <H>Onde ficam os dados</H>
      <P>Os dados ficam armazenados em um provedor de banco de dados e arquivos em nuvem contratado pelo administrador. As fotos de anúncios são acessadas por links difíceis de adivinhar; comprovantes ficam em área privada.</P>
      <H>Seus direitos</H>
      <P>Você pode corrigir seus dados em Perfil → Conta e excluir sua conta a qualquer momento. Ao excluir, apagamos seus dados de contato e anonimizamos o perfil. Registros de vendas e comissões são mantidos pelo prazo necessário para cumprir obrigações legais e resolver eventuais disputas, sem seus dados de contato.</P>
      <P>Para outros pedidos (acesso, portabilidade, dúvidas), fale com o administrador da comunidade.</P>
    </>
  );
}

function Help({ rate }: { rate: string }) {
  return (
    <>
      <H>Como anunciar</H>
      <P>Toque em <b>Anunciar</b>, tire ou escolha as fotos, preencha nome, categoria, estado e preço, revise e publique. A primeira foto é a capa.</P>
      <H>Como negociar</H>
      <P>No anúncio, toque em <b>Conversar</b> ou <b>Fazer proposta</b>. O vendedor pode aceitar, recusar ou fazer uma contraproposta. Combinem retirada e pagamento pela conversa.</P>
      <H>Vendi! E agora?</H>
      <P>No seu anúncio, toque em <b>Marcar como vendido</b>, escolha o comprador e informe o valor real. O app calcula a comissão ({rate}) e mostra o Pix do administrador. Depois de pagar, toque em <b>Já paguei</b>.</P>
      <H>Instalar na tela inicial</H>
      <ul className="mb-3 list-disc pl-5">
        <Li><b>iPhone/iPad (Safari):</b> toque em Compartilhar (quadrado com seta) → “Adicionar à Tela de Início”.</Li>
        <Li><b>Android (Chrome):</b> menu ⋮ → “Instalar app” ou “Adicionar à tela inicial”.</Li>
        <Li><b>Computador (Chrome/Edge):</b> ícone de instalar na barra de endereço.</Li>
      </ul>
      <H>Sem internet</H>
      <P>O app abre mesmo sem conexão, mas mensagens, propostas, vendas e pagamentos só são enviados com internet. Se algo não for enviado, o app avisa.</P>
    </>
  );
}

export function LegalPage({ doc }: { doc: "termos" | "privacidade" | "ajuda" }) {
  const nav = useNavigate();
  const { settings, session } = useAuth();
  const rate = formatRate(settings.commission_rate_bps);
  const title = doc === "termos" ? "Termos de utilização" : doc === "privacidade" ? "Privacidade e seus dados" : "Ajuda";
  return (
    <div className="min-h-dvh bg-page">
      <div className="mx-auto max-w-2xl px-5 pb-16 pt-[max(16px,env(safe-area-inset-top))]">
        <button onClick={() => (window.history.length > 1 ? nav(-1) : nav(session ? "/" : "/entrar"))} className="-ml-2 mb-2 rounded-full p-2.5 hover:bg-black/[0.04]" aria-label="Voltar">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <h1 className="text-[26px] font-extrabold tracking-tight">{title}</h1>
        {doc !== "ajuda" && <p className="mt-1 text-sm text-muted">Versão 1 · Texto-base sujeito a revisão jurídica antes do uso comercial.</p>}
        <div className="mt-4">
          {doc === "termos" && <Terms rate={rate} due={settings.payment_due_days} grace={settings.overdue_grace_days} />}
          {doc === "privacidade" && <Privacy />}
          {doc === "ajuda" && <Help rate={rate} />}
        </div>
        {doc === "termos" && settings.participation_policy && (
          <>
            <H>Política de participação definida pelo administrador</H>
            <P>{settings.participation_policy}</P>
          </>
        )}
        <p className="mt-10 text-sm text-muted"><Link to="/termos" className="underline">Termos</Link> · <Link to="/privacidade" className="underline">Privacidade</Link> · <Link to="/ajuda" className="underline">Ajuda</Link></p>
      </div>
    </div>
  );
}
