import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  async function handleLogout() {
    try {
      await fetch("/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch (error) {
      console.error("Erreur logout:", error);
    }

    window.location.replace("/login");
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-14 flex items-center border-b bg-card px-4 gap-4 shrink-0 z-10">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />

            <div className="flex items-center gap-3 ml-auto">
              <button
                onClick={handleLogout}
                className="px-3 py-1.5 rounded-md bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors"
              >
                Déconnexion
              </button>

              <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
                <span className="text-xs font-medium text-primary-foreground">
                  AD
                </span>
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-auto p-6 animate-fade-in">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}