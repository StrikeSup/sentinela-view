import { Link, useRouterState } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  LayoutDashboard,
  Users,
  Server,
  HardDrive,
  Database,
  FileBarChart,
  UserCog,
  MonitorPlay,
  MonitorSmartphone,
  LayoutGrid,
  LayoutPanelTop,
  ScrollText,
  Repeat,
  PlayCircle,
  Upload,
  ScanEye,
  BellRing,
  LifeBuoy,
  Download,
  Scale,
  Settings,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { BrandLockup, BrandMark } from "@/components/Brand";
import { useAuth, type AppPermission } from "@/lib/auth";
import { cn } from "@/lib/utils";

type Folha = { title: string; url: string; icon: typeof Users; perm: AppPermission };
type Entrada = Folha | { title: string; icon: typeof Users; filhos: Folha[] };

const menu: Entrada[] = [
  { title: "Início", url: "/dashboard", icon: LayoutDashboard, perm: "dashboard.ver" },
  { title: "Clientes", url: "/clientes", icon: Users, perm: "clientes.ver" },
  {
    title: "Servidores",
    icon: Server,
    filhos: [
      { title: "Servidores", url: "/servidores", icon: Server, perm: "servidores.ver" },
      { title: "Carga e failover", url: "/carga-servidores", icon: Scale, perm: "servidores.ver" },
      { title: "Discos", url: "/discos", icon: Database, perm: "discos.ver" },
    ],
  },
  { title: "DVRs", url: "/dvrs", icon: HardDrive, perm: "dvrs.ver" },
  { title: "Visualização", url: "/visualizacao", icon: MonitorPlay, perm: "visualizacao.ver" },
  { title: "Gerenciamento de telas", url: "/monitoramento", icon: MonitorSmartphone, perm: "monitoramento.ver" },
  {
    title: "Personalização",
    icon: LayoutGrid,
    filhos: [
      { title: "Mosaicos", url: "/mosaicos", icon: LayoutGrid, perm: "mosaicos.ver" },
      { title: "Layouts", url: "/layouts", icon: LayoutPanelTop, perm: "visualizacao.ver" },
      { title: "Ronda", url: "/ronda", icon: Repeat, perm: "ronda.ver" },
      { title: "Detecção", url: "/deteccao", icon: ScanEye, perm: "deteccao.ver" },
      { title: "Eventos", url: "/eventos", icon: BellRing, perm: "deteccao.ver" },
    ],
  },
  { title: "Reprodução", url: "/reproducao", icon: PlayCircle, perm: "gravacoes.ver" },
  { title: "Importações", url: "/importacoes", icon: Upload, perm: "importacoes.ver" },
  { title: "Relatórios", url: "/relatorios", icon: FileBarChart, perm: "relatorios.ver" },
  { title: "Logs", url: "/log", icon: ScrollText, perm: "log.ver" },
  { title: "Usuários", url: "/usuarios", icon: UserCog, perm: "usuarios.ver" },
  { title: "Central de ajuda", url: "/ajuda", icon: LifeBuoy, perm: "ajuda.ver" },
  { title: "Downloads", url: "/downloads", icon: Download, perm: "downloads.ver" },
];

function GrupoFlutuante({
  title,
  icon: Icone,
  filhos,
  pathname,
}: {
  title: string;
  icon: typeof Users;
  filhos: Folha[];
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abrir = () => {
    clearTimeout(timer.current);
    setOpen(true);
  };
  const fechar = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 150);
  };
  const ativo = filhos.some((f) => pathname.startsWith(f.url));
  return (
    <SidebarMenuItem>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <SidebarMenuButton isActive={ativo} onMouseEnter={abrir} onMouseLeave={fechar} onClick={abrir}>
            <Icone className="h-4 w-4" />
            <span>{title}</span>
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          className="w-52 p-1.5"
          onMouseEnter={abrir}
          onMouseLeave={fechar}
          onOpenAutoFocus={(ev) => ev.preventDefault()}
        >
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{title}</div>
          {filhos.map((f) => (
            <Link
              key={f.url}
              to={f.url}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent hover:text-accent-foreground",
                pathname.startsWith(f.url) && "bg-accent font-medium text-accent-foreground",
              )}
            >
              <f.icon className="h-4 w-4" />
              {f.title}
            </Link>
          ))}
        </PopoverContent>
      </Popover>
      <ChevronRight className="pointer-events-none absolute -right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />

    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { can, isMaster } = useAuth();
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});

  const folha = (item: Folha) => (
    <SidebarMenuItem key={item.url}>
      <SidebarMenuButton asChild isActive={pathname.startsWith(item.url)} tooltip={item.title}>
        <Link to={item.url} className="flex items-center gap-2">
          <item.icon className="h-4 w-4" />
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  return (
    <>
      {collapsed && (
        <SidebarTrigger className="fixed left-16 top-8 z-50 h-7 w-7 -translate-x-1/2 -translate-y-1/2 shrink-0 bg-transparent hover:opacity-70 [&>svg]:h-5 [&>svg]:w-5" />
      )}
      <Sidebar collapsible="icon" className="overflow-visible [&_[data-sidebar=sidebar]]:overflow-visible">
        <SidebarHeader
          className={
            collapsed
              ? "relative h-16 flex-row items-center justify-center overflow-visible border-b px-0"
              : "h-16 flex-row items-center justify-between gap-2 border-b px-3"
          }
        >
          {collapsed ? <BrandMark variant="compacto" sizeOverride={28} /> : <BrandLockup compact={false} />}
          {!collapsed && <SidebarSeparator className="mx-0 h-6" />}
          {!collapsed && <SidebarTrigger />}
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {menu.map((e) => {
                  if (!("filhos" in e)) return can(e.perm) ? folha(e) : null;
                  const filhos = e.filhos.filter((f) => can(f.perm));
                  if (filhos.length === 0) return null;
                  if (collapsed)
                    return (
                      <GrupoFlutuante
                        key={e.title}
                        title={e.title}
                        icon={e.icon}
                        filhos={filhos}
                        pathname={pathname}
                      />
                    );
                  const ativo = filhos.some((f) => pathname.startsWith(f.url));
                  const aberto = abertos[e.title] ?? ativo;
                  return (
                    <SidebarMenuItem key={e.title}>
                      <SidebarMenuButton
                        isActive={ativo && !aberto}
                        onClick={() => setAbertos({ ...abertos, [e.title]: !aberto })}
                      >
                        <e.icon className="h-4 w-4" />
                        <span>{e.title}</span>
                        <ChevronDown className={cn("ml-auto h-4 w-4 transition-transform", aberto && "rotate-180")} />
                      </SidebarMenuButton>
                      {aberto && (
                        <SidebarMenuSub>
                          {filhos.map((f) => (
                            <SidebarMenuSubItem key={f.url}>
                              <SidebarMenuSubButton asChild isActive={pathname.startsWith(f.url)}>
                                <Link to={f.url}>
                                  <f.icon />
                                  <span>{f.title}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        {(can("usuarios.ver") || can("personalizacao.ver") || can("diagnostico.ver") || isMaster) && (
          <SidebarFooter className="border-t">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={["/configuracoes", "/personalizacao", "/api-integracao", "/diagnostico-webrtc"].some((p) =>
                    pathname.startsWith(p),
                  )}
                  tooltip="Configurações"
                >
                  <Link to="/configuracoes" className="flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    <span>Configurações</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        )}
      </Sidebar>
    </>
  );
}
