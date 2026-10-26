import { useMemo, useState, type ReactNode } from "react";
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

export type ComboOption = { value: string; label: string; hint?: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  /** Desenho mostrado ao lado da lista; recebe a opção sob o mouse (ou a selecionada). */
  renderPreview?: (option: ComboOption | null) => ReactNode;
};

export function ComboSelect({
  value,
  onChange,
  options,
  placeholder = "Selecionar...",
  searchPlaceholder = "Pesquisar...",
  emptyText = "Nenhum resultado encontrado.",
  disabled,
  className,
  renderPreview,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const [destaque, setDestaque] = useState<string | null>(null);
  const selecionado = useMemo(() => options.find((o) => o.value === value), [options, value]);
  const opcaoPreview = useMemo(
    () =>
      (destaque ? options.find((o) => o.value === destaque) : undefined) ??
      selecionado ??
      null,
    [destaque, options, selecionado],
  );

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
          <span className={cn("truncate", !selecionado && "text-muted-foreground")}>
            {selecionado?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn(
          "p-0",
          renderPreview
            ? "flex w-auto min-w-[--radix-popover-trigger-width] items-start gap-2 border-0 bg-transparent shadow-none"
            : "w-[--radix-popover-trigger-width]",
        )}
        align="start"
      >
        <div
          className={cn(
            "min-w-[230px] flex-1",
            renderPreview && "overflow-hidden rounded-md border bg-popover shadow-md",
          )}
          onMouseLeave={() => setDestaque(null)}
        >

          <Command
            filter={(itemValue, search) =>
              itemValue.split("\u0001")[0]!.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(search.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()) ? 1 : 0
            }
          >
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem
                    key={o.value}
                    value={`${o.label} ${o.hint ?? ""}\u0001${o.value}`}
                    onSelect={() => {
                      onChange(o.value);
                      setAberto(false);
                      setDestaque(null);
                    }}
                    onMouseEnter={() => setDestaque(o.value)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        o.value === value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{o.label}</span>
                    {o.hint && (
                      <span className="ml-auto pl-2 text-xs text-muted-foreground">{o.hint}</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
        {renderPreview && (
          <div className="flex w-44 shrink-0 items-start justify-center">
            {renderPreview(opcaoPreview)}
          </div>

        )}
      </PopoverContent>
    </Popover>
  );
}
