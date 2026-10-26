import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ComboOption } from "@/components/ComboSelect";

type Props = {
  values: string[];
  onChange: (values: string[]) => void;
  options: ComboOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  /** Quando informado, mostra a opção "Todos" e usa esse rótulo quando tudo estiver marcado. */
  allLabel?: string;
};

export function ComboMultiSelect({
  values,
  onChange,
  options,
  placeholder = "Selecionar...",
  searchPlaceholder = "Pesquisar...",
  emptyText = "Nenhum resultado encontrado.",
  disabled,
  className,
  allLabel,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const selecionados = options.filter((o) => values.includes(o.value));
  const todos = options.length > 0 && selecionados.length === options.length;
  const rotulo =
    allLabel && todos
      ? allLabel
      : selecionados.length === 0
        ? placeholder
        : selecionados.length <= 2
          ? selecionados.map((o) => o.label).join(", ")
          : `${selecionados.length} selecionados`;

  return (
    <Popover open={aberto} onOpenChange={setAberto} modal>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={aberto}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className={cn("truncate", selecionados.length === 0 && "text-muted-foreground")}>
            {rotulo}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          filter={(itemValue, search) =>
            itemValue.split("\u0001")[0]!.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(search.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {allLabel && options.length > 0 && (
                <CommandItem
                  value={`__todos__ ${allLabel}`}
                  onSelect={() => onChange(todos ? [] : options.map((o) => o.value))}
                >
                  <Check className={cn("mr-2 h-4 w-4", todos ? "opacity-100" : "opacity-0")} />
                  <span className="font-medium">{allLabel}</span>
                </CommandItem>
              )}
              {options.map((o) => {
                const marcado = values.includes(o.value);
                return (
                  <CommandItem
                    key={o.value}
                    value={`${o.label} ${o.hint ?? ""}\u0001${o.value}`}
                    onSelect={() =>
                      onChange(
                        marcado ? values.filter((v) => v !== o.value) : [...values, o.value],
                      )
                    }
                  >
                    <Check className={cn("mr-2 h-4 w-4", marcado ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{o.label}</span>
                    {o.hint && (
                      <span className="ml-auto pl-2 text-xs text-muted-foreground">{o.hint}</span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
