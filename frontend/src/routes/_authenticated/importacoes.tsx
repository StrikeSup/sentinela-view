import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { mosaicoAutomatico } from "@/lib/mosaicos";
import { servidoresQuery } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { ComboSelect } from "@/components/ComboSelect";
import { useClienteSelecionado } from "@/lib/cliente-context";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Upload, FileUp, Check, Download } from "lucide-react";
import {
  CAMPOS,
  csvModelo,
  decodificar,
  lerCsv,
  montarDvrs,
  sugerirMapeamento,
  type CampoDvr,
  type TabelaCsv,
  type TipoImportacao,
} from "@/lib/importacao";

export const Route = createFileRoute("/_authenticated/importacoes")({
  head: () => ({
    meta: [
      { title: "Importações — Sentinela VIEW" },
      {
        name: "description",
        content: "Importe DVRs em massa a partir de arquivos CSV exportados do DGUARD ou DIGIFORT.",
      },
      { property: "og:title", content: "Importações — Sentinela VIEW" },
      { property: "og:description", content: "Cadastro de DVRs em massa por arquivo CSV." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ImportacoesPage,
});

const TIPOS: { valor: TipoImportacao; rotulo: string; ajuda: string }[] = [
  { valor: "dguard", rotulo: "DGUARD", ajuda: "Arquivo CSV exportado do DGUARD" },
  { valor: "digifort", rotulo: "DIGIFORT", ajuda: "Arquivo CSV exportado do DIGIFORT" },
  { valor: "modelo", rotulo: "Planilha modelo", ajuda: "Modelo de planilha do Sentinela" },
];

function baixarModelo() {
  const url = URL.createObjectURL(new Blob([csvModelo()], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "modelo-importacao-dvrs.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function ImportacoesPage() {
  const { can, user } = useAuth();
  const qc = useQueryClient();
  
  const servidores = useQuery(servidoresQuery);
  const {
    clienteId: clienteGlobal,
    setClienteId: setClienteGlobal,
    clientes: clientesPermitidos,
    bloqueado,
  } = useClienteSelecionado();

  const [tipo, setTipo] = useState<TipoImportacao>("dguard");
  const [arquivo, setArquivo] = useState<string>("");
  const [tabela, setTabela] = useState<TabelaCsv | null>(null);
  const [mapa, setMapa] = useState<Record<CampoDvr, string> | null>(null);
  const [servidorId, setServidorId] = useState("");
  const [diasBackup, setDiasBackup] = useState(7);

  const podeImportar = can("importacoes.criar");
  const clienteId = clienteGlobal;

  const servidoresDoCliente = (servidores.data ?? []).filter((s) => s.cliente_id === clienteId);

  const carregarTexto = (texto: string, nomeArquivo: string) => {
    const lida = lerCsv(texto);
    if (lida.colunas.length === 0 || lida.linhas.length === 0) {
      toast.error("Não encontrei linhas neste arquivo.");
      return;
    }
    setArquivo(nomeArquivo);
    setTabela(lida);
    setMapa(sugerirMapeamento(tipo, lida.colunas));
  };

  const aoEscolherArquivo = async (file: File | undefined) => {
    if (!file) return;
    const texto = decodificar(await file.arrayBuffer());
    carregarTexto(texto, file.name);
  };

  const trocarTipo = (novo: TipoImportacao) => {
    setTipo(novo);
    if (tabela) setMapa(sugerirMapeamento(novo, tabela.colunas));
  };

  const linhas = useMemo(
    () => (tabela && mapa ? montarDvrs(tabela, mapa) : []),
    [tabela, mapa],
  );
  const validas = linhas.filter((l) => !l.erro);

  const importar = useMutation({
    mutationFn: async () => {
      if (!clienteId) throw new Error("Escolha o cliente.");
      if (validas.length === 0) throw new Error("Nenhuma linha válida para importar.");

      const criados: { id: string; nome: string; canais: number; cliente_id: string }[] = [];
      for (const l of validas) {
        const { data, error } = await supabase
          .from("dvrs")
          .insert({
            cliente_id: clienteId,
            servidor_id: servidorId || null,
            nome: l.nome,
            fabricante: l.fabricante ?? tipoRotulo(tipo),
            modelo: l.modelo,
            canais: l.canais,
            canais_gravacao: Array.from({ length: l.canais }, (_, i) => i + 1),
            usuario: l.usuario,
            senha: l.senha,
            ip_interno: l.ip_interno,
            porta_http_interna: l.porta_http_interna,
            porta_rtsp_interna: l.porta_rtsp_interna,
            ip_externo: l.ip_externo,
            porta_http_externa: l.porta_http_externa,
            cloud: l.cloud,
            porta_http_cloud: l.porta_http_cloud,
            porta_cloud: l.porta_cloud,
            dias_backup: diasBackup,
            ativo: true,
          })
          .select("id, nome, canais, cliente_id")
          .single();
        if (error) throw error;
        criados.push({ ...data, canais: data.canais ?? 0 });
      }

      // Cada DVR importado nasce com um layout contendo todas as suas câmeras.
      for (const dvr of criados) {
        const total = Math.max(1, Math.min(64, dvr.canais || 1));
        const auto = mosaicoAutomatico(total);
        const slots = Array.from({ length: total }, (_, i) => ({
          dvr_id: dvr.id,
          canal: i + 1,
        })) as unknown as Json;
        await supabase.from("layouts_visualizacao").insert({
          nome: dvr.nome,
          colunas: auto.colunas,
          linhas: auto.linhas,
          template: `auto-${total}`,
          slots,
          cliente_id: dvr.cliente_id,
          criado_por: user?.id ?? null,
        });
      }
      return criados.length;
    },
    onSuccess: (n) => {
      toast.success(`${n} DVR(s) importado(s).`);
      qc.invalidateQueries({ queryKey: ["dvrs"] });
      qc.invalidateQueries({ queryKey: ["layouts"] });
      setTabela(null);
      setMapa(null);
      setArquivo("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Importações"
        description="Cadastre vários DVRs de uma vez usando um arquivo exportado do DGUARD ou do DIGIFORT."
      />

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4 p-4">
              <div className="space-y-2">
                <Label>Tipo de importação</Label>
                <div className="grid grid-cols-3 gap-2">
                  {TIPOS.map((t) => (
                    <button
                      key={t.valor}
                      type="button"
                      onClick={() => trocarTipo(t.valor)}
                      className={`rounded-lg border px-3 py-3 text-left text-sm transition ${
                        tipo === t.valor
                          ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                          : "hover:bg-muted/60"
                      }`}
                    >
                      <span className="flex items-center gap-1 font-medium">
                        {t.rotulo}
                        {tipo === t.valor && <Check className="h-3.5 w-3.5 text-primary" />}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">{t.ajuda}</span>
                    </button>
                  ))}
                </div>
                {tipo === "modelo" && (
                  <Button type="button" variant="outline" size="sm" onClick={baixarModelo}>
                    <Download className="mr-2 h-4 w-4" />
                    Baixar planilha modelo
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                <Label>Cliente</Label>
                <ComboSelect
                  value={clienteId}
                  onChange={setClienteGlobal}
                  options={clientesPermitidos.map((c) => ({ value: c.id, label: c.nome }))}
                  disabled={bloqueado}
                  placeholder="Escolher cliente"
                  searchPlaceholder="Pesquisar cliente..."
                />
              </div>

              <div className="space-y-2">
                <Label>Servidor (opcional)</Label>
                <ComboSelect
                  value={servidorId}
                  onChange={setServidorId}
                  options={servidoresDoCliente.map((s) => ({ value: s.id, label: s.nome }))}
                  placeholder="Sem servidor"
                  searchPlaceholder="Pesquisar servidor..."
                  disabled={!clienteId}
                />
              </div>

              <div className="space-y-2">
                <Label>Dias de backup</Label>
                <Input
                  type="number"
                  min={1}
                  value={diasBackup}
                  onChange={(e) => setDiasBackup(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>

              <div className="space-y-2">
                <Label>Arquivo CSV</Label>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground hover:bg-muted/50">
                  <FileUp className="h-4 w-4" />
                  <span className="truncate">{arquivo || "Escolher arquivo .csv"}</span>
                  <input
                    type="file"
                    accept=".csv,text/csv,text/plain"
                    className="hidden"
                    onChange={(e) => aoEscolherArquivo(e.target.files?.[0])}
                  />
                </label>
              </div>
            </CardContent>
          </Card>

          {tabela && mapa && (
            <Card>
              <CardContent className="space-y-3 p-4">
                <p className="text-xs font-medium text-muted-foreground">
                  Conferir colunas do arquivo
                </p>
                {CAMPOS.map(({ campo, rotulo, obrigatorio }) => (
                  <div key={campo} className="space-y-1">
                    <Label className="text-xs">
                      {rotulo}
                      {obrigatorio && <span className="ml-1 text-destructive">*</span>}
                    </Label>
                    <ComboSelect
                      value={mapa[campo]}
                      onChange={(v) => setMapa({ ...mapa, [campo]: v === "__vazio" ? "" : v })}
                      options={[
                        { value: "__vazio", label: "Não usar" },
                        ...tabela.colunas.map((c) => ({ value: c, label: c })),
                      ]}
                      placeholder="Não usar"
                      searchPlaceholder="Pesquisar coluna..."
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardContent className="p-4">
            {!tabela ? (
              <div className="flex min-h-[420px] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <Upload className="h-6 w-6" />
                Escolha o tipo e envie o arquivo CSV para ver a prévia dos DVRs.
              </div>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="secondary">{linhas.length} linhas</Badge>
                    <Badge>{validas.length} prontas</Badge>
                    {linhas.length - validas.length > 0 && (
                      <Badge variant="destructive">
                        {linhas.length - validas.length} com problema
                      </Badge>
                    )}
                  </div>
                  <Button
                    disabled={
                      !podeImportar || !clienteId || validas.length === 0 || importar.isPending
                    }
                    onClick={() => importar.mutate()}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    {importar.isPending ? "Importando..." : `Importar ${validas.length} DVR(s)`}
                  </Button>
                </div>
                {!clienteId && (
                  <p className="mb-2 text-xs text-destructive">
                    Escolha o cliente antes de importar.
                  </p>
                )}
                <div className="max-h-[60vh] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>IP</TableHead>
                        <TableHead>Porta</TableHead>
                        <TableHead>Usuário</TableHead>
                        <TableHead>Câmeras</TableHead>
                        <TableHead>Situação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linhas.map((l, i) => (
                        <TableRow key={`${l.nome}-${i}`}>
                          <TableCell className="font-medium">{l.nome || "—"}</TableCell>
                          <TableCell>{l.ip_interno ?? "—"}</TableCell>
                          <TableCell>{l.porta_http_interna ?? "—"}</TableCell>
                          <TableCell>{l.usuario ?? "—"}</TableCell>
                          <TableCell>{l.canais || "—"}</TableCell>
                          <TableCell>
                            {l.erro ? (
                              <Badge variant="destructive">{l.erro}</Badge>
                            ) : (
                              <Badge variant="secondary">Pronto</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function tipoRotulo(tipo: TipoImportacao) {
  if (tipo === "dguard") return "DGUARD";
  if (tipo === "digifort") return "DIGIFORT";
  return null;
}
