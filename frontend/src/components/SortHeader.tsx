import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type Ordem<T extends string> = { campo: T; asc: boolean };

export function SortHeader<T extends string>({
  campo,
  ordem,
  setOrdem,
  className,
  children,
}: {
  campo: T;
  ordem: Ordem<T>;
  setOrdem: (o: Ordem<T>) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const ativo = ordem.campo === campo;
  return (
    <TableHead className={className}>
      <button
        type="button"
        className={cn(
          "-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground",
          ativo ? "text-foreground" : "text-muted-foreground",
        )}
        onClick={() => setOrdem({ campo, asc: ativo ? !ordem.asc : true })}
      >
        {children}
        {ativo ? (
          ordem.asc ? (
            <ArrowUp className="h-3.5 w-3.5" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
        )}
      </button>
    </TableHead>
  );
}

export function comparar(a: unknown, b: unknown, asc: boolean) {
  const va = a ?? "";
  const vb = b ?? "";
  let r: number;
  if (typeof va === "number" && typeof vb === "number") r = va - vb;
  else if (typeof va === "boolean" && typeof vb === "boolean") r = Number(va) - Number(vb);
  else r = String(va).localeCompare(String(vb), "pt-BR", { numeric: true, sensitivity: "base" });
  return asc ? r : -r;
}
