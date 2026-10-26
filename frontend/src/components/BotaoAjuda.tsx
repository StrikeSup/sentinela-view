import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { HelpCircle, BookOpen, Pencil, PlayCircle } from "lucide-react";
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
import { useAuth } from "@/lib/auth";
import { garantirTela, listarPassos, type AjudaTela } from "@/lib/ajuda";
import { TourGuiado } from "@/components/TourGuiado";
import { AjudaEditor } from "@/components/AjudaEditor";

export function BotaoAjuda() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { isMaster } = useAuth();
  const [tour, setTour] = useState(false);
  const [editor, setEditor] = useState(false);
  const [tela, setTela] = useState<AjudaTela | null>(null);

  const rota = "/" + (pathname.split("/").filter(Boolean)[0] ?? "");

  const { data: passos = [], refetch, error } = useQuery({
    queryKey: ["ajuda-passos", rota],
    retry: 1,
    queryFn: async () => {
      const t = await garantirTela(rota, rota.replace("/", "") || "Início");
      setTela(t);
      return listarPassos(t.id);
    },
  });

  const iniciarTour = () => {
    if (error) {
      toast.error(`Não foi possível carregar a ajuda: ${(error as Error).message}`);
      return;
    }
    if (passos.length === 0) {
      toast.info("Esta tela ainda não tem passos cadastrados.");
      return;
    }
    setTour(true);
  };

  const abrirEditor = async () => {
    try {
      const t = tela ?? (await garantirTela(rota, rota.replace("/", "") || "Início"));
      setTela(t);
      setEditor(true);
    } catch (e) {
      toast.error(`Não foi possível abrir o editor: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Ajuda desta tela">
            <HelpCircle className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>Ajuda desta tela</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={iniciarTour}>
            <PlayCircle className="mr-2 h-4 w-4" /> Iniciar passo a passo
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/ajuda">
              <BookOpen className="mr-2 h-4 w-4" /> Central de ajuda
            </Link>
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
