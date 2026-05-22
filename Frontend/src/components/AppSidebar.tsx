import { NavLink } from "@/components/NavLink";
import {
  LayoutDashboard,
  FileText,
  Landmark,
  Receipt,
  Settings,
  HelpCircle,
  HandCoins,
  Plug,
  SendHorizontal,
  Wallet,
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
import { APP_TITLE, APP_SUBTITLE, APP_LOGO_PATH } from "@/config/app-config";
import { useState } from "react";

const mainNav = [
  { title: "Tableau de bord", url: "/", icon: LayoutDashboard },
  { title: "Banque", url: "/banque", icon: Landmark },
  { title: "Factures", url: "/factures", icon: FileText },
  { title: "SEPA", url: "/sepa", icon: SendHorizontal },
  { title: "Bulletins de paie", url: "/bulletins", icon: Wallet },
  { title: "Affacturage", url: "/affacturage", icon: HandCoins },
  { title: "TVA", url: "/tva", icon: Receipt },
  { title: "TVA", subtitle: "particuliers", url: "/tva-particuliers", icon: Receipt },
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
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-border">
            <img
              src={APP_LOGO_PATH}
              alt={`${APP_TITLE}`}
              width={40}
              height={40}
              className="h-8 w-8 object-contain"
            />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold tracking-tight text-foreground">
              {APP_TITLE}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">{APP_SUBTITLE}</span>
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
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      activeClassName="bg-primary/10 text-primary font-medium"
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="flex min-w-0 flex-col leading-tight">
                        <span>{item.title}</span>
                        {"subtitle" in item && item.subtitle ? (
                          <span className="truncate text-[10px] font-normal text-muted-foreground">
                            {item.subtitle}
                          </span>
                        ) : null}
                      </span>
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
