import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { AppNotification, Category, ConversationRow, ListingCardData } from "./types";
import { useAuth } from "@/auth/AuthProvider";

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("*").order("sort_order");
      if (error) throw error;
      return data as Category[];
    },
    staleTime: 30 * 60_000,
  });
}

export interface SearchParams {
  query?: string;
  category?: string | null;
  minCents?: number | null;
  maxCents?: number | null;
  conditions?: string[];
  location?: string;
  acceptsOffers?: boolean | null;
  acceptsTrade?: boolean | null;
  donation?: boolean | null;
  sinceDays?: number | null;
  includeReserved?: boolean;
  seller?: string | null;
  exclude?: string | null;
  sort?: "recent" | "price_asc" | "price_desc" | "relevance";
}

export const PAGE_SIZE = 24;

function rpcArgs(p: SearchParams, limit: number, offset: number) {
  return {
    p_query: p.query?.trim() || null,
    p_category: p.category || null,
    p_min_cents: p.minCents ?? null,
    p_max_cents: p.maxCents ?? null,
    p_conditions: p.conditions && p.conditions.length ? p.conditions : null,
    p_location: p.location?.trim() || null,
    p_accepts_offers: p.acceptsOffers ?? null,
    p_accepts_trade: p.acceptsTrade ?? null,
    p_donation: p.donation ?? null,
    p_since_days: p.sinceDays ?? null,
    p_include_reserved: p.includeReserved ?? true,
    p_seller: p.seller ?? null,
    p_exclude: p.exclude ?? null,
    p_sort: p.sort ?? "recent",
    p_limit: limit,
    p_offset: offset,
  };
}

export async function searchListings(p: SearchParams, limit = PAGE_SIZE, offset = 0): Promise<ListingCardData[]> {
  const { data, error } = await supabase.rpc("search_listings", rpcArgs(p, limit, offset));
  if (error) throw error;
  return (data ?? []) as ListingCardData[];
}

/** Lista com "carregar mais" (paginação por blocos). */
export function useListingFeed(p: SearchParams, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["listings", "feed", p],
    enabled,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => searchListings(p, PAGE_SIZE, pageParam),
    getNextPageParam: (last, all) => (last.length < PAGE_SIZE ? undefined : all.length * PAGE_SIZE),
    staleTime: 30_000,
  });
}

export function useListingStrip(key: string, p: SearchParams, limit = 10, enabled = true) {
  return useQuery({
    queryKey: ["listings", "strip", key, p],
    enabled,
    queryFn: () => searchListings(p, limit, 0),
    staleTime: 60_000,
  });
}

export function useFavorites() {
  const { userId, isActive } = useAuth();
  return useQuery({
    queryKey: ["favorites", userId],
    enabled: Boolean(userId) && isActive,
    queryFn: async () => {
      const { data, error } = await supabase.from("favorites").select("listing_id");
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.listing_id as string));
    },
    staleTime: 5 * 60_000,
  });
}

export function useUnread() {
  const { userId, isActive } = useAuth();
  return useQuery({
    queryKey: ["unread", userId],
    enabled: Boolean(userId) && isActive,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("unread_counts");
      if (error) throw error;
      return data as { messages: number; notifications: number };
    },
    staleTime: 60_000,
  });
}

export function useConversations() {
  const { userId, isActive } = useAuth();
  return useQuery({
    queryKey: ["conversations", userId],
    enabled: Boolean(userId) && isActive,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_conversations");
      if (error) throw error;
      return (data ?? []) as ConversationRow[];
    },
    staleTime: 30_000,
  });
}

export function useNotifications() {
  const { userId, isActive } = useAuth();
  return useQuery({
    queryKey: ["notifications", userId],
    enabled: Boolean(userId) && isActive,
    queryFn: async () => {
      const { data, error } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as AppNotification[];
    },
    staleTime: 60_000,
  });
}
