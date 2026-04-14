import { NavLink } from "@/components/NavLink";
import {
  LayoutDashboard,
  FileText,
  Landmark,
  ArrowLeftRight,
  Receipt,
  Settings,
  HelpCircle,
  Building2,
  HandCoins,
  Plug,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { csvHelpText } from "@/lib/mock-data";
import { APP_TITLE, APP_SUBTITLE } from "@/config/app-config";
import { useState } from "react";

const mainNav = [
  { title: "Tableau de bord", url: "/", icon: LayoutDashboard },

  /*{ title: "Rapprochement", url: "/rapprochement", icon: ArrowLeftRight },*/
  { title: "Banque", url: "/banque", icon: Landmark },
  { title: "Factures", url: "/factures", icon: FileText },
 
  { title: "Affacturage", url: "/affacturage", icon: HandCoins },
  { title: "TVA", url: "/tva", icon: Receipt },
];

const secondaryNav = [
  { title: "Import", url: "/import", icon: FileText },
  { title: "Connecteurs", url: "/connecteurs", icon: Plug },
  { title: "Paramètres", url: "/parametres", icon: Settings },
];

export function AppSidebar() {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <Sidebar className="border-r">
      <SidebarHeader className="p-4 border-b">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <Building2 className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-foreground">{APP_TITLE}</span>
            <span className="text-[11px] text-muted-foreground">{APP_SUBTITLE}</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-4">
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/60 px-3 mb-1">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      activeClassName="bg-primary/10 text-primary font-medium"
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-6">
          <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/60 px-3 mb-1">
            Configuration
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {secondaryNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      activeClassName="bg-primary/10 text-primary font-medium"
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3 border-t">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setShowHelp(!showHelp)}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors w-full"
            >
              <HelpCircle className="h-4 w-4" />
              <span>Aide — Formats CSV</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-sm whitespace-pre-line text-xs font-mono">
            {csvHelpText}
          </TooltipContent>
        </Tooltip>
      </SidebarFooter>
    </Sidebar>
  );
}
