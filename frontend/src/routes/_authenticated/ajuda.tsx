import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { BookOpen, Pencil, Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { listarTelas, listarTodosPassos, type AjudaTela } from "@/lib/ajuda";
import { AjudaEditor } from "@/components/AjudaEditor";

export const Route = createFileRoute("/_authenticated/ajuda")({
  head: () => ({
    meta: [
      { title: "Central de ajuda — Sentinela VIEW" },
      {
        name: "description",
        content: "Explicações e passo a passo de cada tela do Sentinela VIEW.",
      },
      { property: "og:title", content: "Central de ajuda — Sentinela VIEW" },
      { property: "og:description", content: "Guia completo de uso de todas as telas." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AjudaPage,
});

function AjudaPage() {
  const { isMaster, can } = useAuth();
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<AjudaTela | null>(null);

  const telasQ = useQuery({ queryKey: ["ajuda-telas"], queryFn: listarTelas });
  const passosQ = useQuery({ queryKey: ["ajuda-todos-passos"], queryFn: listarTodosPassos });

  const recarregar = () => {
    void telasQ.refetch();
    void passosQ.refetch();
  };

  const grupos = useMemo(() => {
    const termo = busca.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const passos = passosQ.data ?? [];
    const lista = (telasQ.data ?? []).filter((t) => {
      if (!termo) return true;
      const meus = passos.filter((p) => p.tela_id === t.id);
      return (
        t.titulo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(termo) ||
        (t.resumo ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(termo) ||
        meus.some(
          (p) => p.titulo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(termo) || p.texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(termo),
        )
      );
    });
    const mapa = new Map<string, AjudaTela[]>();
    for (const t of lista) {
      const atual = mapa.get(t.categoria) ?? [];
      atual.push(t);
      mapa.set(t.categoria, atual);
    }
    return Array.from(mapa.entries());
  }, [telasQ.data, passosQ.data, busca]);

  const passosDe = (id: string) => (passosQ.data ?? []).filter((p) => p.tela_id === id);
  const rotaPrincipal = (rota: string) => {
    const primeiroTrecho = rota.split("/").filter(Boolean)[0];
    return primeiroTrecho ? `/${primeiroTrecho}` : "/dashboard";
  };

  if (!can("ajuda.ver")) {
    return (
      <div className="p-6 text-muted-foreground">Você não tem permissão para a Central de ajuda.</div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Central de ajuda"
        description="Explicação de cada tela e o passo a passo de como usá-la."
      />

      <div className="relative mb-6 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Buscar por tela ou assunto"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      {(telasQ.isError || passosQ.isError) && (
        <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="font-medium">Não foi possível carregar a ajuda.</p>
          <p className="mt-1 break-words">
            {((telasQ.error ?? passosQ.error) as Error | null)?.message}
          </p>
          <p className="mt-2 text-xs">
            Rode o arquivo 2026-09-24-central-ajuda-recarregar.sql no SQL Editor e tente de novo.
          </p>
          <Button size="sm" variant="outline" className="mt-3" onClick={recarregar}>
            Tentar de novo
          </Button>
        </div>
      )}

      {telasQ.isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      {!telasQ.isLoading && !telasQ.isError && grupos.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {busca ? "Nada encontrado para essa busca." : "Nenhuma tela de ajuda cadastrada ainda."}
        </p>
      )}

      <div className="space-y-8">
        {grupos.map(([categoria, telas]) => (
          <section key={categoria}>
            <h2 className="mb-3 font-display text-lg font-semibold">{categoria}</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {telas.map((t) => {
                const passos = passosDe(t.id);
                return (
                  <Card key={t.id}>
                    <CardContent className="space-y-3 p-4">
                      <div className="flex items-start gap-2">
                        <BookOpen className="mt-0.5 h-4 w-4 text-primary" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{t.titulo}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{t.resumo}</p>
                        </div>
                        <Badge variant="secondary">{passos.length}</Badge>
                      </div>

                      {passos.length > 0 && (
                        <ol className="space-y-2 border-l pl-3 text-sm">
                          {passos.map((p, i) => (
                            <li key={p.id}>
                              <p className="font-medium">
                                {i + 1}. {p.titulo}
                              </p>
                              {p.texto && (
                                <p className="whitespace-pre-wrap text-muted-foreground">{p.texto}</p>
                              )}
                              {p.imagem_url && (
                                <img
                                  src={p.imagem_url}
                                  alt={p.titulo}
                                  className="mt-1 max-h-40 w-full rounded border object-contain"
                                />
                              )}
                            </li>
                          ))}
                        </ol>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" asChild>
                          <Link to={rotaPrincipal(t.rota) as "/dashboard"}>Ir para a tela</Link>
                        </Button>
                        {isMaster && (
                          <Button size="sm" variant="ghost" onClick={() => setEditando(t)}>
                            <Pencil className="mr-1 h-4 w-4" /> Editar
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {editando && (
        <AjudaEditor
          tela={editando}
          aberto={!!editando}
          onFechar={() => setEditando(null)}
          onSalvo={recarregar}
        />
      )}
    </div>
  );
}
