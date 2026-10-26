import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight } from "lucide-react";

const OPCOES = [10, 20, 30];

export function usePaginacao<T>(itens: T[], padrao = 10) {
  const [porPagina, setPorPagina] = useState(padrao);
  const [pagina, setPagina] = useState(1);
  const [personalizado, setPersonalizado] = useState(false);

  const total = itens.length;
  const totalPaginas = Math.max(1, Math.ceil(total / Math.max(1, porPagina)));

  useEffect(() => {
    setPagina((p) => Math.min(p, totalPaginas));
  }, [totalPaginas]);

  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = useMemo(
    () => itens.slice((paginaAtual - 1) * porPagina, paginaAtual * porPagina),
    [itens, paginaAtual, porPagina],
  );

  return {
    visiveis,
    total,
    totalPaginas,
    pagina: paginaAtual,
    setPagina,
    porPagina,
    setPorPagina,
    personalizado,
    setPersonalizado,
  };
}

type PaginacaoProps = {
  total: number;
  totalPaginas: number;
  pagina: number;
  setPagina: (n: number) => void;
  porPagina: number;
  setPorPagina: (n: number) => void;
  personalizado: boolean;
  setPersonalizado: (v: boolean) => void;
  rotulo?: string;
};

export function Paginacao({
  total,
  totalPaginas,
  pagina,
  setPagina,
  porPagina,
  setPorPagina,
  personalizado,
  setPersonalizado,
  rotulo = "registros",
}: PaginacaoProps) {
  const inicio = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const fim = Math.min(total, pagina * porPagina);

  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Por página</span>
        <Select
          value={personalizado ? "custom" : String(porPagina)}
          onValueChange={(v) => {
            if (v === "custom") {
              setPersonalizado(true);
              return;
            }
            setPersonalizado(false);
            setPorPagina(Number(v));
            setPagina(1);
          }}
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPCOES.map((o) => (
              <SelectItem key={o} value={String(o)}>
                {o}
              </SelectItem>
            ))}
            <SelectItem value="custom">Personalizado</SelectItem>
          </SelectContent>
        </Select>
        {personalizado && (
          <Input
            type="number"
            min={1}
            max={1000}
            className="w-24"
            value={porPagina}
            onChange={(e) => {
              const n = Math.max(1, Math.min(1000, Number(e.target.value) || 1));
              setPorPagina(n);
              setPagina(1);
            }}
          />
        )}
      </div>

      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">
          {inicio}–{fim} de {total} {rotulo}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            disabled={pagina <= 1}
            onClick={() => setPagina(pagina - 1)}
            aria-label="Página anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-16 text-center text-muted-foreground">
            {pagina} / {totalPaginas}
          </span>
          <Button
            variant="outline"
            size="icon"
            disabled={pagina >= totalPaginas}
            onClick={() => setPagina(pagina + 1)}
            aria-label="Próxima página"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
