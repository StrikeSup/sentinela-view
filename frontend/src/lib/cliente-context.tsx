import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { clientesQuery } from "@/lib/queries";
import { useAuth } from "@/lib/auth";

const STORAGE_KEY = "sentinela:cliente-selecionado";

type ClienteResumo = { id: string; nome: string };

type Ctx = {
  clienteId: string;
  setClienteId: (id: string) => void;
  clientes: ClienteResumo[];
  /** true quando o usuário só tem acesso a um cliente — a seleção fica travada */
  bloqueado: boolean;
};

const ClienteContext = createContext<Ctx>({
  clienteId: "",
  setClienteId: () => {},
  clientes: [],
  bloqueado: false,
});

export function ClienteProvider({ children }: { children: ReactNode }) {
  const clientes = useQuery(clientesQuery);
  const { clienteIds } = useAuth();
  const [clienteId, setClienteIdState] = useState("");

  useEffect(() => {
    const salvo = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (salvo) setClienteIdState(salvo);
  }, []);

  // Filtra a lista de clientes conforme as permissões do usuário.
  // clienteIds === null → acesso a todos; string[] → restrito a estes.
  const lista = useMemo<ClienteResumo[]>(
    () =>
      (clientes.data ?? [])
        .filter((c) => clienteIds === null || clienteIds.includes(c.id))
        .map((c) => ({ id: c.id, nome: c.nome })),
    [clientes.data, clienteIds],
  );

  // precisa ser estável: telas extras reagem a mudanças deste contexto e
  // uma função nova a cada render fazia o mosaico ser reaplicado sozinho
  const setClienteId = useCallback((id: string) => {
    setClienteIdState(id);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, id);
  }, []);

  useEffect(() => {
    if (!lista.length) return;
    // um único cliente disponível: seleção travada nele
    if (lista.length === 1) {
      if (clienteId !== lista[0]!.id) setClienteId(lista[0]!.id);
      return;
    }
    // cliente salvo que o usuário não acessa mais
    if (clienteId && !lista.some((c) => c.id === clienteId)) setClienteId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista, clienteId]);

  const valor = useMemo(
    () => ({ clienteId, setClienteId, clientes: lista, bloqueado: lista.length === 1 }),
    [clienteId, setClienteId, lista],
  );

  return <ClienteContext.Provider value={valor}>{children}</ClienteContext.Provider>;
}

export const useClienteSelecionado = () => useContext(ClienteContext);
