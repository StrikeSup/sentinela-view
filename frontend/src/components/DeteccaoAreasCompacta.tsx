import { verificarLimiteDeteccao } from "@/lib/tipos-deteccao";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eraser, Grid2x2, Save, SquareDashed } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { dvrsQuery } from "@/lib/queries";
import { useAuth } from "@/lib/auth";
import { CameraAoVivo } from "@/components/CameraAoVivo";
import { ComboSelect } from "@/components/ComboSelect";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

import { GRADE_COLUNAS, GRADE_LINHAS, mascaraPadrao } from "@/lib/deteccao-grade";

// Mesma grade da página completa e do Agent (registros antigos são remapeados).
const COLUNAS = GRADE_COLUNAS;
const LINHAS = GRADE_LINHAS;

type CameraLinha = {
  id: string;
  dvr_id: string;
  canal: number;
  nome: string | null;
  servidor_id: string | null;
  cliente_id: string | null;
};

type Config = {
  id: string;
  dvr_id: string;
  canal: number;
  ativo: boolean;
  colunas: number;
  linhas: number;
  ignorados: number[];
  sensibilidade: number;
};

/** Áreas por câmera em versão compacta, para usar dentro da aba "Layouts de detecção". */
export function DeteccaoAreasCompacta({ clienteId }: { clienteId: string | null }) {
  const { can } = useAuth();
  const podeEditar = can("deteccao.editar");
  const queryClient = useQueryClient();
  const dvrs = useQuery(dvrsQuery);

  const idsDvrs = useMemo(
    () =>
      (dvrs.data ?? [])
        .filter((d) => d.cliente_id === clienteId)
        .map((d) => d.id),
    [dvrs.data, clienteId],
  );

  const camerasQ = useQuery({
    queryKey: ["deteccao-cameras", idsDvrs],
    enabled: idsDvrs.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cameras")
        .select("id, dvr_id, canal, nome, servidor_id, cliente_id")
        .in("dvr_id", idsDvrs)
        .order("canal");
      if (error) throw error;
      return (data ?? []) as unknown as CameraLinha[];
    },
  });

  const nomeDvr = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const d of dvrs.data ?? []) mapa.set(d.id, d.nome);
    return mapa;
  }, [dvrs.data]);

  const opcoesCameras = useMemo(
    () =>
      (camerasQ.data ?? []).map((c) => ({
        value: `${c.dvr_id}:${c.canal}`,
        label: c.nome?.trim() || `Canal ${c.canal}`,
        hint: nomeDvr.get(c.dvr_id) ?? "",
      })),
    [camerasQ.data, nomeDvr],
  );

  const [cameraKey, setCameraKey] = useState("");
  useEffect(() => {
    if (cameraKey && !opcoesCameras.some((o) => o.value === cameraKey)) setCameraKey("");
  }, [opcoesCameras, cameraKey]);

  const [camDvrId, camCanalTexto] = cameraKey ? cameraKey.split(":") : ["", ""];
  const camCanal = Number(camCanalTexto);
  const cameraSelecionada = Boolean(camDvrId) && Number.isFinite(camCanal);

  const configQ = useQuery({
    queryKey: ["deteccao-config", cameraKey],
    enabled: cameraSelecionada,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cameras_deteccao" as never)
        .select("id, dvr_id, canal, ativo, colunas, linhas, ignorados, sensibilidade")
        .eq("dvr_id", camDvrId ?? "")
        .eq("canal", camCanal)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as Config | null;
    },
  });

  const [ignorados, setIgnorados] = useState<Set<number>>(new Set());
  const [sensibilidade, setSensibilidade] = useState(50);
  const [ativo, setAtivo] = useState(true);

  useEffect(() => {
    if (!cameraSelecionada) return;
    const c = configQ.data;
    setIgnorados(new Set(mascaraPadrao(c)));
    setSensibilidade(c?.sensibilidade ?? 50);
    setAtivo(c?.ativo ?? true);
  }, [configQ.data, cameraSelecionada]);

  /* ---------- pintura da grade ---------- */

  const pintando = useRef<null | "marcar" | "desmarcar">(null);

  const aplicar = (indice: number, modo: "marcar" | "desmarcar") => {
    setIgnorados((atual) => {
      const proximo = new Set(atual);
      if (modo === "marcar") proximo.add(indice);
      else proximo.delete(indice);
      return proximo;
    });
  };

  useEffect(() => {
    const soltar = () => {
      pintando.current = null;
    };
    window.addEventListener("pointerup", soltar);
    return () => window.removeEventListener("pointerup", soltar);
  }, []);

  const salvar = useMutation({
    mutationFn: async () => {
      const camera = (camerasQ.data ?? []).find(
        (c) => c.dvr_id === camDvrId && c.canal === camCanal,
      );
      const dvr = (dvrs.data ?? []).find((d) => d.id === camDvrId);
      const linha = {
        cliente_id: camera?.cliente_id ?? dvr?.cliente_id ?? null,
        servidor_id: camera?.servidor_id ?? dvr?.servidor_id ?? null,
        dvr_id: camDvrId,
        canal: camCanal,
        ativo,
        colunas: COLUNAS,
        linhas: LINHAS,
        ignorados: Array.from(ignorados).sort((a, b) => a - b),
        sensibilidade,
      };
      if (ativo) await verificarLimiteDeteccao(linha.cliente_id, "movimento", camDvrId ?? "", camCanal);
      const { error } = await supabase
        .from("cameras_deteccao" as never)
        .upsert(linha as never, { onConflict: "dvr_id,canal" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configuração de detecção salva.");
      queryClient.invalidateQueries({ queryKey: ["deteccao-config", cameraKey] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const celulas = COLUNAS * LINHAS;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <Label>Áreas por câmera</Label>
        <ComboSelect
          value={cameraKey}
          onChange={setCameraKey}
          options={opcoesCameras}
          placeholder={
            !clienteId
              ? "Escolha o cliente primeiro"
              : camerasQ.isLoading
                ? "Carregando câmeras..."
                : opcoesCameras.length
                  ? "Selecionar câmera"
                  : "Nenhuma câmera encontrada"
          }
          emptyText="Nenhuma câmera encontrada."
        />

        {cameraSelecionada && (
          <>
            <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black">
              <CameraAoVivo
                key={cameraKey}
                dvrId={camDvrId!}
                canal={camCanal}
                contido
                qualidade="extra"
              />
              <div
                className="absolute inset-0 grid touch-none select-none"
                style={{
                  gridTemplateColumns: `repeat(${COLUNAS}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${LINHAS}, minmax(0, 1fr))`,
                }}
                onPointerLeave={() => {
                  pintando.current = null;
                }}
              >
                {Array.from({ length: celulas }, (_, i) => {
                  const desativada = ignorados.has(i);
                  return (
                    <div
                      key={i}
                      role="presentation"
                      onPointerDown={(e) => {
                        if (!podeEditar) return;
                        e.preventDefault();
                        const modo = desativada ? "desmarcar" : "marcar";
                        pintando.current = modo;
                        aplicar(i, modo);
                      }}
                      onPointerEnter={() => {
                        if (!podeEditar || !pintando.current) return;
                        aplicar(i, pintando.current);
                      }}
                      className={
                        desativada
                          ? "border border-destructive/30 bg-destructive/45"
                          : "border border-white/10 hover:bg-primary/20"
                      }
                    />
                  );
                })}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Clique e arraste para marcar as áreas ignoradas; clique de novo para liberar.
            </p>

            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <Label className="text-sm">Detecção de movimento</Label>
                <p className="truncate text-xs text-muted-foreground">
                  Liga ou desliga esta câmera.
                </p>
              </div>
              <Switch checked={ativo} onCheckedChange={setAtivo} disabled={!podeEditar} />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Sensibilidade</Label>
                <span className="text-sm text-muted-foreground">{sensibilidade}%</span>
              </div>
              <Slider
                value={[sensibilidade]}
                onValueChange={(v) => setSensibilidade(v[0] ?? 50)}
                min={1}
                max={100}
                step={1}
                disabled={!podeEditar}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Áreas</Label>
                <span className="text-xs text-muted-foreground">
                  {ignorados.size} de {celulas}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={!podeEditar}
                  onClick={() => setIgnorados(new Set())}
                >
                  <Eraser className="mr-1 h-3.5 w-3.5" /> Limpar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={!podeEditar}
                  onClick={() => setIgnorados(new Set(Array.from({ length: celulas }, (_, i) => i)))}
                >
                  <SquareDashed className="mr-1 h-3.5 w-3.5" /> Marcar tudo
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={!podeEditar}
                  onClick={() =>
                    setIgnorados((atual) => {
                      const proximo = new Set<number>();
                      for (let i = 0; i < celulas; i++) if (!atual.has(i)) proximo.add(i);
                      return proximo;
                    })
                  }
                >
                  <Grid2x2 className="mr-1 h-3.5 w-3.5" /> Inverter
                </Button>
              </div>
            </div>

            <Button
              type="button"
              className="w-full"
              size="sm"
              disabled={!podeEditar || salvar.isPending}
              onClick={() => salvar.mutate()}
            >
              <Save className="mr-2 h-4 w-4" />
              {salvar.isPending ? "Salvando..." : "Salvar configuração"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
