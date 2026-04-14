import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "@/components/Layout";
import Dashboard from "./pages/Dashboard";
import Rapprochement from "./pages/Rapprochement";
import ImportPage from "./pages/Import";
import Factures from "./pages/Factures";
import Banque from "./pages/Banque";
import Affacturage from "./pages/Affacturage";
import TVA from "./pages/TVA";
import Parametres from "./pages/Parametres";
import Connecteurs from "./pages/connecteurs";
import NotFound from "./pages/NotFound";
import BridgeCallback from "./pages/BridgeCallback";
const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/rapprochement" element={<Rapprochement />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/factures" element={<Factures />} />
            <Route path="/banque" element={<Banque />} />
            <Route path="/affacturage" element={<Affacturage />} />
            <Route path="/tva" element={<TVA />} />
            <Route path="/parametres" element={<Parametres />} />
            <Route path="/connecteurs" element={<Connecteurs />} />
            <Route path="*" element={<NotFound />} />
            <Route path="/bridge/callback" element={<BridgeCallback />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
