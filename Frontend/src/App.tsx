import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import { Layout } from "@/components/Layout";

import Dashboard from "./pages/Dashboard";
import Rapprochement from "./pages/Rapprochement";
import ImportPage from "./pages/Import";
import Factures from "./pages/Factures";
import Banque from "./pages/Banque";
import SepaPage from "./pages/Sepa";
import BulletinsPaiePage from "./pages/BulletinsPaie";
import Affacturage from "./pages/Affacturage";
import TVA from "./pages/TVA";
import Parametres from "./pages/Parametres";
import Connecteurs from "./pages/connecteurs";
import NotFound from "./pages/NotFound";
import BridgeCallback from "./pages/BridgeCallback";
import Login from "./pages/login";
import ProtectedRoute from "./components/ProtectedRoute";

const queryClient = new QueryClient();

function ProtectedLayout() {
  return (
    <ProtectedRoute>
      <Layout>
        <Outlet />
      </Layout>
    </ProtectedRoute>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/rapprochement" element={<Rapprochement />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/factures" element={<Factures />} />
            <Route path="/banque" element={<Banque />} />
            <Route path="/sepa" element={<SepaPage />} />
            <Route path="/bulletins" element={<BulletinsPaiePage />} />
            <Route path="/affacturage" element={<Affacturage />} />
            <Route path="/tva" element={<TVA />} />
            <Route path="/parametres" element={<Parametres />} />
            <Route path="/connecteurs" element={<Connecteurs />} />
            <Route path="/bridge/callback" element={<BridgeCallback />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;