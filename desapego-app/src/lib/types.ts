export type Role = "member" | "moderator" | "admin";
export type AccountStatus = "pending" | "active" | "suspended" | "deleted";
export type Condition = "novo" | "seminovo" | "usado";
export type ListingType = "venda" | "doacao";
export type ListingStatus = "draft" | "pending_review" | "active" | "paused" | "reserved" | "sold" | "suspended" | "deleted";
export type OfferStatus = "pending" | "countered" | "accepted" | "rejected" | "cancelled";
export type SaleType = "venda" | "troca" | "doacao";
export type CommissionStatus = "awaiting_payment" | "payment_reported" | "under_review" | "paid" | "cancelled" | "refunded" | "waived";
export type EffectiveCommissionStatus = CommissionStatus | "overdue";

export interface Profile {
  id: string;
  name: string;
  avatar_url: string | null;
  location: string | null;
  contact_preferences: { whatsapp_in_chat?: boolean };
  role: Role;
  account_status: AccountStatus;
  created_at: string;
}

export interface Category { id: string; name: string; icon: string; sort_order: number; active: boolean }

export interface Listing {
  id: string;
  seller_id: string;
  category_id: string;
  title: string;
  description: string;
  asking_price_cents: number;
  condition: Condition;
  listing_type: ListingType;
  accepts_offers: boolean;
  accepts_trade: boolean;
  location: string | null;
  delivery_options: string[];
  notes: string | null;
  status: ListingStatus;
  cover_path: string | null;
  cover_thumb_path: string | null;
  image_count: number;
  published_at: string | null;
  sold_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListingImage { id: string; listing_id: string; storage_path: string; thumb_path: string; width: number | null; height: number | null; display_order: number }

/** Linha devolvida por search_listings (vitrine e busca). */
export interface ListingCardData {
  id: string;
  title: string;
  asking_price_cents: number;
  condition: Condition;
  listing_type: ListingType;
  accepts_offers: boolean;
  accepts_trade: boolean;
  location: string | null;
  status: ListingStatus;
  category_id: string;
  cover_path: string | null;
  cover_thumb_path: string | null;
  published_at: string | null;
  created_at: string;
  seller_id: string;
  seller_name: string;
}

export interface ConversationRow {
  id: string;
  listing_id: string;
  listing_title: string;
  listing_price_cents: number;
  listing_status: ListingStatus;
  listing_thumb: string | null;
  i_am_seller: boolean;
  other_id: string;
  other_name: string;
  other_avatar: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  unread: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  kind: "text" | "offer" | "system" | "whatsapp" | "sale";
  content: string;
  metadata: Record<string, unknown>;
  client_id: string | null;
  created_at: string;
  read_at: string | null;
}

export interface Offer {
  id: string;
  listing_id: string;
  conversation_id: string | null;
  buyer_id: string;
  seller_id: string;
  proposed_by: string;
  amount_cents: number;
  status: OfferStatus;
  parent_offer_id: string | null;
  created_at: string;
  responded_at: string | null;
}

export interface Sale {
  id: string;
  listing_id: string;
  seller_id: string;
  buyer_id: string | null;
  buyer_external_name: string | null;
  sale_type: SaleType;
  final_price_cents: number;
  commission_rate_snapshot: number;
  commission_cents: number;
  completion_status: "completed" | "cancelled";
  buyer_confirmation: "not_applicable" | "pending" | "confirmed" | "disputed";
  completed_at: string;
  cancel_reason: string | null;
}

export interface CommissionView {
  id: string;
  sale_id: string;
  seller_id: string;
  base_cents: number;
  rate_bps: number;
  original_amount_cents: number;
  amount_cents: number;
  due_at: string;
  status: CommissionStatus;
  effective_status: EffectiveCommissionStatus;
  reminder_sent_at: string | null;
  paid_at: string | null;
  admin_note: string | null;
  created_at: string;
  listing_id: string;
  final_price_cents: number;
  sale_type: SaleType;
  completed_at: string;
  listing_title: string;
  listing_thumb: string | null;
  seller_name: string;
}

export interface PaymentReport {
  id: string;
  commission_id: string;
  reported_by: string;
  receipt_path: string | null;
  note: string | null;
  status: "submitted" | "accepted" | "rejected";
  review_note: string | null;
  created_at: string;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface Settings {
  app_name: string;
  commission_rate_bps: number;
  payment_due_days: number;
  overdue_grace_days: number;
  pix_key: string;
  pix_receiver_name: string;
  pix_city: string;
  max_photos: number;
  max_active_listings: number;
  moderation_mode: "post" | "pre";
  participation_policy: string;
}

export const DEFAULT_SETTINGS: Settings = {
  app_name: "Desapego da Família",
  commission_rate_bps: 500,
  payment_due_days: 7,
  overdue_grace_days: 10,
  pix_key: "",
  pix_receiver_name: "",
  pix_city: "",
  max_photos: 10,
  max_active_listings: 30,
  moderation_mode: "post",
  participation_policy: "",
};
