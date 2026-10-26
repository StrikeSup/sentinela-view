import { useCallback, useEffect, useRef, useState } from "react";
import { Monitor } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import {
  abrirTelaAgora,
  consolidarTelas,
  emTelaExtra,
  gravarTelas,
  lerTelas,
  lerTelasRemotas,
  removerTelasRemotas,
  reservarTelas,
  restaurarTelas,
  salvarTela,
  type TelaExtra,
} from "@/lib/telas-extras";
import {
  concluirPermissoes,
  marcarTelasRestauradas,
  pedirPermissoes,
  telasJaRestauradas,
} from "@/lib/permissoes";

const SEGUNDOS = 5;

/**
 * Logo após entrar, pergunta se deve reabrir as telas que o usuário
 * deixou montadas na última vez. Sem resposta em 5 segundos, tenta sozinho.
 * Se o navegador barrar (bloqueio de pop-ups), mostra um botão por tela:
 * um clique abre uma janela, e o navegador sempre permite isso.
 */
export function RestaurarTelas() {
  const { user, profile } = useAuth();
  const restaurarAtivo = profile?.restaurar_sessao !== false;
  const [lista, setLista] = useState<TelaExtra[]>([]);
  const [bloqueadas, setBloqueadas] = useState<TelaExtra[]>([]);
  const [restante, setRestante] = useState(SEGUNDOS);
  const [abrindo, setAbrindo] = useState(false);
  const janelas = useRef<Record<string, Window>>({});

  const abrir = useCallback(
    async (comGesto: boolean) => {
      setAbrindo(true);
      // window.open precisa acontecer imediatamente no clique; qualquer await antes
      // faz o navegador consumir a autorização e bloquear as telas seguintes.
      // vale para o clique e para a tentativa automática: abrir primeiro,
      // pois qualquer espera antes disso faz o navegador barrar as janelas.
      void comGesto;
      const reservadas = reservarTelas(lista);
      const permissoes = await pedirPermissoes();
      const r = await restaurarTelas(
        lista,
        (tela, w) => {
          janelas.current[tela.id] = w;
        },
        reservadas,
      );
      concluirPermissoes();
      setAbrindo(false);

      if (r.abertas) {
        toast.success(
          `${r.abertas} tela${r.abertas > 1 ? "s" : ""} reaberta${r.abertas > 1 ? "s" : ""}.`,
        );
        if (!permissoes.monitores && lista.some((t) => t.monitorId)) {
          toast.info("As telas abriram, mas o navegador não liberou o posicionamento nos monitores.");
        }
        if (r.realocadas.length) {
          toast.info(
            r.realocadas.length > 1
              ? `${r.realocadas.length} telas abriram em outro monitor porque os originais não estão conectados. A memória foi mantida.`
              : "Uma tela abriu em outro monitor porque o original não está conectado. A memória foi mantida.",
          );
        }
      }

      if (r.bloqueadas.length) {
        setBloqueadas(r.bloqueadas);
        setLista(r.bloqueadas);
        return;
      }

      if (user?.id) marcarTelasRestauradas(user.id);
      setBloqueadas([]);
      setLista([]);
    },
    [lista, user?.id],
  );

  // um clique só, abrindo todas as telas que faltaram de uma vez
  const abrirTodas = useCallback(() => {
    const restantes: TelaExtra[] = [];
    for (const tela of bloqueadas) {
      const w = abrirTelaAgora(tela);
      if (w) {
        janelas.current[tela.id] = w;
        salvarTela(tela);
      } else {
        restantes.push(tela);
      }
    }
    const abertas = bloqueadas.length - restantes.length;
    if (abertas) toast.success(`${abertas} tela${abertas > 1 ? "s" : ""} reaberta${abertas > 1 ? "s" : ""}.`);
    if (restantes.length)
      toast.error("O navegador bloqueou algumas telas. Libere as janelas pop-up deste site.");
    setBloqueadas(restantes);
    setLista(restantes);
    if (!restantes.length && user?.id) marcarTelasRestauradas(user.id);
  }, [bloqueadas, user?.id]);

  // abre uma tela isolada: um clique = uma janela, o navegador sempre permite
  const abrirUma = useCallback(
    (tela: TelaExtra) => {
      const w = abrirTelaAgora(tela);
      if (!w) {
        toast.error("O navegador bloqueou esta tela. Libere as janelas pop-up deste site.");
        return;
      }
      janelas.current[tela.id] = w;
      salvarTela(tela);
      const restantes = bloqueadas.filter((t) => t.id !== tela.id);
      setBloqueadas(restantes);
      setLista(restantes);
      if (!restantes.length && user?.id) marcarTelasRestauradas(user.id);
    },
    [bloqueadas, user?.id],
  );

  // busca as telas guardadas na conta do usuário
  useEffect(() => {
    if (!user?.id || emTelaExtra() || !restaurarAtivo) return;
    if (typeof window === "undefined") return;
    if (telasJaRestauradas(user.id)) return;

    let ativo = true;
    void (async () => {
      const remotas = await lerTelasRemotas(user.id);
      if (!ativo) return;
      const locais = lerTelas();
      const origem = remotas.length ? remotas : locais;
      const { telas: juntas, removidas } = consolidarTelas(origem);
      if (removidas.length) {
        void removerTelasRemotas(user.id, removidas.map((t) => t.id));
      }
      if (!juntas.length) return;
      gravarTelas(juntas);
      setLista(juntas);
      setRestante(SEGUNDOS);
    })();
    return () => {
      ativo = false;
    };
  }, [user?.id]);

  // contagem regressiva: sem resposta, tenta sozinho
  useEffect(() => {
    if (!lista.length || abrindo || bloqueadas.length) return;
    if (restante <= 0) {
      void abrir(false);
      return;
    }
    const t = setTimeout(() => setRestante((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [lista, restante, abrindo, bloqueadas.length, abrir]);

  if (!lista.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[130] w-[340px] rounded-xl border bg-card p-4 shadow-lg">
      <div className="flex items-start gap-3">
        <Monitor className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {bloqueadas.length ? "Faltaram telas para abrir" : "Abrir suas telas como da última vez?"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {bloqueadas.length
              ? "O navegador só deixa abrir uma janela por clique. Toque em cada tela abaixo, ou permita janelas pop-up deste site (ícone ao lado do endereço) para abrir todas de uma vez."
              : `${lista.length} tela${lista.length > 1 ? "s" : ""} com os mesmos mosaicos e monitores. Abrindo em ${restante}s…`}
          </p>
        </div>
      </div>

      {bloqueadas.length > 0 && (
        <div className="mt-3 space-y-2">
          <Button size="sm" className="w-full" onClick={abrirTodas}>
            Abrir as {bloqueadas.length} telas de uma vez
          </Button>
          {bloqueadas.map((t, i) => (
            <Button
              key={t.id}
              variant="secondary"
              size="sm"
              className="w-full justify-start"
              onClick={() => abrirUma(t)}
            >
              Abrir tela {i + 2}
            </Button>
          ))}
        </div>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (user?.id) marcarTelasRestauradas(user.id);
            setBloqueadas([]);
            setLista([]);
          }}
        >
          {bloqueadas.length ? "Fechar" : "Agora não"}
        </Button>
        {!bloqueadas.length && (
          <Button size="sm" disabled={abrindo} onClick={() => void abrir(true)}>
            {abrindo ? "Abrindo…" : "Abrir agora"}
          </Button>
        )}
      </div>
    </div>
  );
}
