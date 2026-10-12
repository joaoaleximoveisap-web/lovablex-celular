import type { Condition, EffectiveCommissionStatus, ListingStatus, OfferStatus, SaleType } from "./types";

export const CONDITION_LABEL: Record<Condition, string> = { novo: "Novo", seminovo: "Seminovo", usado: "Usado" };

export const LISTING_STATUS_LABEL: Record<ListingStatus, string> = {
  draft: "Rascunho",
  pending_review: "Em análise",
  active: "Disponível",
  paused: "Pausado",
  reserved: "Reservado",
  sold: "Vendido",
  suspended: "Suspenso",
  deleted: "Excluído",
};

export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  pending: "Proposta enviada",
  countered: "Contraproposta",
  accepted: "Aceita",
  rejected: "Recusada",
  cancelled: "Cancelada",
};

export const SALE_TYPE_LABEL: Record<SaleType, string> = { venda: "Venda", troca: "Troca", doacao: "Doação" };

export const COMMISSION_STATUS: Record<EffectiveCommissionStatus, { label: string; tone: "neutral" | "warn" | "danger" | "ok" | "info" }> = {
  awaiting_payment: { label: "Aguardando pagamento", tone: "warn" },
  overdue: { label: "Em atraso", tone: "danger" },
  payment_reported: { label: "Pagamento informado", tone: "info" },
  under_review: { label: "Em conferência", tone: "info" },
  paid: { label: "Pago", tone: "ok" },
  cancelled: { label: "Cancelado", tone: "neutral" },
  refunded: { label: "Estornado", tone: "neutral" },
  waived: { label: "Isento", tone: "neutral" },
};

export const DELIVERY_LABEL: Record<string, string> = { retirada: "Retirada", entrega: "Entrega combinada", envio: "Envio" };

export const REPORT_REASONS: { id: string; label: string }[] = [
  { id: "proibido", label: "Produto proibido ou ilegal" },
  { id: "golpe", label: "Suspeita de golpe" },
  { id: "ofensivo", label: "Conteúdo ofensivo" },
  { id: "informacao_falsa", label: "Informação falsa" },
  { id: "spam", label: "Spam ou repetido" },
  { id: "outro", label: "Outro motivo" },
];
