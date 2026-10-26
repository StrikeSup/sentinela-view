import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { ComboMultiSelect } from "@/components/ComboMultiSelect";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export type LayoutCameraSlot = { dvr_id: string; canal: number };

type DvrOption = { id: string; nome: string; canais: number; servidor?: string };

type Props = {
  dvrs: DvrOption[];
  dvrIds: string[];
  onDvrIdsChange: (ids: string[]) => void;
  cameras: LayoutCameraSlot[];
  onCamerasChange: (cameras: LayoutCameraSlot[]) => void;
  limite: number;
};

function chaveCamera(camera: LayoutCameraSlot) {
  return `${camera.dvr_id}:${camera.canal}`;
}

export function LayoutCameraSelector({
  dvrs,
  dvrIds,
  onDvrIdsChange,
  cameras,
  onCamerasChange,
  limite,
}: Props) {
  const catalogo = useQuery({
    queryKey: ["cameras-layout", dvrIds],
    enabled: dvrIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cameras")
        .select("dvr_id, canal, nome, online")
        .in("dvr_id", dvrIds)
        .order("canal");
      if (error) throw error;
      return data ?? [];
    },
  });

  const disponiveis = useMemo(
    () =>
      dvrIds.flatMap((dvrId) => {
        const dvr = dvrs.find((item) => item.id === dvrId);
        if (!dvr) return [];
        const encontradas = (catalogo.data ?? []).filter((camera) => camera.dvr_id === dvrId);
        const porCanal = new Map(encontradas.map((camera) => [camera.canal, camera]));
        const total = Math.max(dvr.canais, ...encontradas.map((camera) => camera.canal), 0);
        return Array.from({ length: total }, (_, indice) => {
          const canal = indice + 1;
          const camera = porCanal.get(canal);
          return {
            dvr,
            dvr_id: dvrId,
            canal,
            nome: camera?.nome?.trim() || `Canal ${canal}`,
            online: camera?.online,
          };
        });
      }),
    [catalogo.data, dvrIds, dvrs],
  );

  const selecionadas = new Set(cameras.map(chaveCamera));
  const trocarDvrs = (ids: string[]) => {
    onDvrIdsChange(ids);
    onCamerasChange(cameras.filter((camera) => ids.includes(camera.dvr_id)));
  };
  const alternarCamera = (camera: LayoutCameraSlot) => {
    const chave = chaveCamera(camera);
    if (selecionadas.has(chave)) {
      onCamerasChange(cameras.filter((item) => chaveCamera(item) !== chave));
      return;
    }
    if (cameras.length >= limite) return;
    onCamerasChange([...cameras, camera]);
  };

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="space-y-2">
        <Label>DVRs deste layout</Label>
        <ComboMultiSelect
          values={dvrIds}
          onChange={trocarDvrs}
          options={dvrs.map((dvr) => ({
            value: dvr.id,
            label: dvr.nome,
            ...(dvr.servidor ? { hint: dvr.servidor } : {}),
          }))}
          placeholder="Selecione um ou mais DVRs"
          searchPlaceholder="Pesquisar DVR..."
          emptyText="Nenhum DVR encontrado."
        />
      </div>

      {dvrIds.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label>Câmeras</Label>
            <span className="text-xs text-muted-foreground">
              {cameras.length} de {limite} selecionadas
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                onCamerasChange(
                  disponiveis
                    .slice(0, limite)
                    .map(({ dvr_id, canal }) => ({ dvr_id, canal })),
                )
              }
            >
              Selecionar disponíveis
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => onCamerasChange([])}>
              Limpar
            </Button>
          </div>
          <div className="grid max-h-48 grid-cols-1 gap-1.5 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
            {disponiveis.map((camera) => {
              const chave = chaveCamera(camera);
              const marcada = selecionadas.has(chave);
              const bloqueada = !marcada && cameras.length >= limite;
              return (
                <label
                  key={chave}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 hover:bg-muted/60 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
                >
                  <Checkbox
                    checked={marcada}
                    disabled={bloqueada}
                    onCheckedChange={() => alternarCamera(camera)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{camera.nome}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {camera.dvr.nome} · canal {camera.canal}
                    </span>
                  </span>
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      camera.online === true
                        ? "bg-primary"
                        : camera.online === false
                          ? "bg-destructive"
                          : "bg-muted-foreground/40"
                    }`}
                  />
                </label>
              );
            })}
            {!disponiveis.length && (
              <p className="col-span-full py-3 text-center text-xs text-muted-foreground">
                Nenhuma câmera disponível nos DVRs selecionados.
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            As câmeras ocuparão o mosaico na ordem em que forem selecionadas.
          </p>
        </div>
      )}
    </div>
  );
}