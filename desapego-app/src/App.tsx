import { lazy, Suspense, type ReactNode } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { ToastProvider } from "./components/ui/toast";
import { Spinner } from "./components/ui/misc";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { isConfigured } from "./lib/supabase";
import { SetupPage } from "./pages/SetupPage";
import { LoginPage, NewPasswordPage, PendingPage, SignupPage } from "./pages/AuthPages";
import { HomePage } from "./pages/HomePage";
import { SearchPage } from "./pages/SearchPage";
import { ListingPage } from "./pages/ListingPage";
import { ConversationsPage } from "./pages/ConversationsPage";
import { ChatPage } from "./pages/ChatPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { ProfilePage } from "./pages/profile/ProfilePage";
import { MemberPage } from "./pages/MemberPage";
import { LegalPage } from "./pages/LegalPage";
import { NotFoundPage } from "./pages/NotFoundPage";

// telas pesadas ou usadas com menos frequência carregam sob demanda
const ListingEditorPage = lazy(() => import("./pages/ListingEditorPage"));
const CommissionPayPage = lazy(() => import("./pages/CommissionPayPage"));
const AdminPage = lazy(() => import("./pages/admin/AdminPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 30_000, networkMode: "online" },
    mutations: { networkMode: "always", retry: 0 },
  },
});

function Splash() {
  return <div className="flex min-h-dvh items-center justify-center bg-page"><Spinner /></div>;
}

function Guarded({ children }: { children: ReactNode }) {
  const { ready, session, profile, recovering } = useAuth();
  const loc = useLocation();
  if (!ready) return <Splash />;
  if (recovering) return <NewPasswordPage />;
  if (!session) return <Navigate to={`/entrar${loc.search}`} replace state={{ from: loc.pathname }} />;
  if (!profile || profile.account_status !== "active") return <PendingPage />;
  return <>{children}</>;
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  return isAdmin ? <>{children}</> : <Navigate to="/" replace />;
}

function AppRoutes() {
  return (
    <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="/entrar" element={<LoginPage />} />
        <Route path="/cadastro" element={<SignupPage />} />
        <Route path="/termos" element={<LegalPage doc="termos" />} />
        <Route path="/privacidade" element={<LegalPage doc="privacidade" />} />
        <Route path="/ajuda" element={<LegalPage doc="ajuda" />} />
        <Route path="/" element={<Guarded><HomePage /></Guarded>} />
        <Route path="/buscar" element={<Guarded><SearchPage /></Guarded>} />
        <Route path="/anuncio/:id" element={<Guarded><ListingPage /></Guarded>} />
        <Route path="/anunciar" element={<Guarded><ListingEditorPage /></Guarded>} />
        <Route path="/anuncio/:id/editar" element={<Guarded><ListingEditorPage /></Guarded>} />
        <Route path="/conversas" element={<Guarded><ConversationsPage /></Guarded>} />
        <Route path="/conversas/:id" element={<Guarded><ChatPage /></Guarded>} />
        <Route path="/notificacoes" element={<Guarded><NotificationsPage /></Guarded>} />
        <Route path="/perfil" element={<Guarded><ProfilePage /></Guarded>} />
        <Route path="/perfil/:tab" element={<Guarded><ProfilePage /></Guarded>} />
        <Route path="/comissoes/:id" element={<Guarded><CommissionPayPage /></Guarded>} />
        <Route path="/membro/:id" element={<Guarded><MemberPage /></Guarded>} />
        <Route path="/admin" element={<Guarded><AdminOnly><AdminPage /></AdminOnly></Guarded>} />
        <Route path="/admin/:tab" element={<Guarded><AdminOnly><AdminPage /></AdminOnly></Guarded>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}

export function App() {
  if (!isConfigured) return <SetupPage />;
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <AppRoutes />
          </HashRouter>
          <UpdatePrompt />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
