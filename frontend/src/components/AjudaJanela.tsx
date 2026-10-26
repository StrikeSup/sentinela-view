import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HelpCircle, Pencil, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AjudaEditor } from "@/components/AjudaEditor";
import { TourGuiado } from "@/components/TourGuiado";
import { useAuth } from "@/lib/auth";
import { garantirTela, listarPassos, type AjudaTela } from "@/lib/ajuda";

export function AjudaJanela({
  rota,
  titulo,
  aberto,
}: {
  rota: string;
  titulo: string;
  aberto: boolean;
}) {
  const { isMaster } = useAuth();
  const [tour, setTour] = useState(false);
  const [editor, setEditor] = useState(false);
  const [tela, setTela] = useState<AjudaTela | null>(null);

  const { data: passos = [], refetch, error } = useQuery({
    queryKey: ["ajuda-passos", rota],
    enabled: aberto,
    retry: 1,
    queryFn: async () => {
      const registro = await garantirTela(rota, titulo, "Janelas de cadastro");
      setTela(registro);
      return listarPassos(registro.id);
    },
  });

  const iniciarTour = () => {
    if (error) {
      toast.error(`Não foi possível carregar a ajuda: ${(error as Error).message}`);
      return;
    }
    if (passos.length === 0) {
      toast.info("Esta janela ainda não tem passos cadastrados.");
      return;
    }
    setTour(true);
  };

  const abrirEditor = async () => {
    try {
      const registro = tela ?? (await garantirTela(rota, titulo, "Janelas de cadastro"));
      setTela(registro);
      setEditor(true);
    } catch (e) {
      toast.error(`Não foi possível abrir o editor: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Ajuda: ${titulo}`}>
            <HelpCircle className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>Ajuda desta janela</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={iniciarTour}>
            <PlayCircle className="mr-2 h-4 w-4" /> Iniciar passo a passo
          </DropdownMenuItem>
          {isMaster && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void abrirEditor()}>
                <Pencil className="mr-2 h-4 w-4" /> Editar os passos
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {tour && <TourGuiado passos={passos} onFechar={() => setTour(false)} />}
      {tela && (
        <AjudaEditor
          tela={tela}
          aberto={editor}
          onFechar={() => setEditor(false)}
          onSalvo={() => void refetch()}
        />
      )}
    </>
  );
}