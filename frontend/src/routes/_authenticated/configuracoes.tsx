import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronDown, FolderCog, Monitor, Factory, Settings2, Palette, Plug, Stethoscope } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ListaCadastro } from "@/components/ListaCadastro";
import { fabricantesQuery, sistemasQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { PersonalizacaoPage } from "./personalizacao";
import { ApiPage } from "./api-integracao";
import { DiagnosticoWebrtc } from "./diagnostico-webrtc";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Sentinela VIEW" },
      { name: "description", content: "Cadastros auxiliares, personalização e API de integração." },
      { property: "og:title", content: "Configurações — Sentinela VIEW" },
      { property: "og:description", content: "Cadastros auxiliares, personalização e API de integração." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConfiguracoesPage,
});

type ItemId = "sistemas" | "fabricantes" | "personalizacao" | "api" | "diagnostico";
type Item = { id: ItemId; rotulo: string; icone: typeof Monitor; descricao?: string; visivel: boolean };

function ConfiguracoesPage() {
  const { can, isMaster } = useAuth();
  const grupos = ([
    {
      id: "cadastro",
      rotulo: "Cadastro",
      icone: FolderCog,
      itens: [
        { id: "sistemas", rotulo: "Sistemas", icone: Monitor, descricao: "Sistemas de terceiros que o cliente pode usar.", visivel: can("usuarios.ver") },
        { id: "fabricantes", rotulo: "Fabricantes", icone: Factory, descricao: "Fabricantes disponíveis no cadastro de DVR.", visivel: can("usuarios.ver") },
      ],
    },
    {
      id: "geral",
      rotulo: "Geral",
      icone: Settings2,
      itens: [
        { id: "personalizacao", rotulo: "Personalização", icone: Palette, visivel: can("personalizacao.ver") },
        { id: "api", rotulo: "API de integração", icone: Plug, visivel: isMaster },
        { id: "diagnostico", rotulo: "Diagnóstico WebRTC", icone: Stethoscope, visivel: can("diagnostico.ver") },
      ],
    },
  ] as { id: string; rotulo: string; icone: typeof Monitor; itens: Item[] }[])
    .map((g) => ({ ...g, itens: g.itens.filter((i) => i.visivel) }))
    .filter((g) => g.itens.length > 0);

  const todos = grupos.flatMap((g) => g.itens);
  const [escolhido, setAtivo] = useState<ItemId | null>(null);
  const [fechados, setFechados] = useState<Record<string, boolean>>({});
  const atual = todos.find((i) => i.id === escolhido) ?? todos[0];

  if (!atual) return <p className="text-sm text-muted-foreground">Sem acesso às configurações.</p>;
  const Icone = atual.icone;

  return (
    <div className="space-y-4">
      <PageHeader title="Configurações" description="Gerencie as configurações e cadastros auxiliares do sistema." />
      <div className="grid gap-4 md:grid-cols-[240px_1fr]">
        <nav className="h-fit space-y-1 rounded-lg border bg-card p-2">
          {grupos.map((g) => {
            const G = g.icone;
            const aberto = !fechados[g.id];
            return (
              <div key={g.id}>
                <button
                  type="button"
                  onClick={() => setFechados({ ...fechados, [g.id]: aberto })}
                  className="flex w-full items-center justify-between rounded-md px-2 py-2 text-sm font-semibold"
                >
                  <span className="flex items-center gap-2">
                    <G className="h-4 w-4 text-primary" /> {g.rotulo}
                  </span>
                  <ChevronDown className={cn("h-4 w-4 transition-transform", aberto && "rotate-180")} />
                </button>
                {aberto && (
                  <div className="mt-1 space-y-1 pl-2">
                    {g.itens.map((i) => {
                      const I = i.icone;
                      return (
                        <button
                          key={i.id}
                          type="button"
                          onClick={() => setAtivo(i.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                            atual.id === i.id
                              ? "bg-primary/10 font-medium text-primary"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          <I className="h-4 w-4" /> {i.rotulo}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <section className="min-w-0 space-y-3">
          {atual.descricao && (
            <div className="flex items-center gap-3">
              <div className="rounded-md bg-primary/10 p-2 text-primary">
                <Icone className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold">{atual.rotulo}</h2>
                <p className="text-sm text-muted-foreground">{atual.descricao}</p>
              </div>
            </div>
          )}
          {atual.id === "sistemas" && (
            <ListaCadastro key="sistemas" tabela="sistemas" query={sistemasQuery} rotulo="Sistema" vazioTexto="Nenhum sistema cadastrado." />
          )}
          {atual.id === "fabricantes" && (
            <ListaCadastro key="fabricantes" tabela="fabricantes" query={fabricantesQuery} rotulo="Fabricante" vazioTexto="Nenhum fabricante cadastrado." />
          )}
          {atual.id === "personalizacao" && <PersonalizacaoPage />}
          {atual.id === "api" && <ApiPage />}
          {atual.id === "diagnostico" && <DiagnosticoWebrtc />}
        </section>
      </div>
    </div>
  );
}
