import { supabase } from "@/integrations/supabase/client";

export type Fabricante = { id: string; nome: string };

export const fabricantesQuery = {
  queryKey: ["fabricantes"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("fabricantes" as never)
      .select("id, nome")
      .order("nome");
    if (error) throw error;
    return (data ?? []) as unknown as Fabricante[];
  },
};

export const sistemasQuery = {
  queryKey: ["sistemas"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("sistemas" as never)
      .select("id, nome")
      .order("nome");
    if (error) throw error;
    return (data ?? []) as unknown as Fabricante[];
  },
};

export const clientesQuery = {
  queryKey: ["clientes"],
  queryFn: async () => {
    const { data, error } = await supabase.from("clientes").select("*").order("nome");
    if (error) throw error;
    return data;
  },
};

export const servidoresQuery = {
  queryKey: ["servidores"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("servidores")
      .select("*, clientes(nome)")
      .order("nome");
    if (error) throw error;
    return data;
  },
};

export const dvrsQuery = {
  queryKey: ["dvrs"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("dvrs")
      .select("*, clientes(nome), servidores!servidor_id(nome)")
      .order("nome");
    if (error) throw error;
    return data;
  },
};

/** Estado real da gravação por câmera, informado pelo servidor local. */
export type GravacaoStatus = {
  dvr_id: string;
  canal: number;
  estado: string;
  qualidade: string | null;
  diagnostico: string | null;
  atualizado_em: string;
};

export const gravacaoStatusQuery = {
  queryKey: ["gravacao-status"],
  refetchInterval: 20000,
  queryFn: async () => {
    const { data, error } = await supabase
      .from("gravacao_status" as never)
      .select("dvr_id, canal, estado, qualidade, diagnostico, atualizado_em");
    if (error) throw error;
    return (data ?? []) as unknown as GravacaoStatus[];
  },
};


export const eventosQuery = {
  queryKey: ["eventos"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("eventos_conexao")
      .select("*, dvrs(nome), clientes(nome), servidores(nome)")
      .order("ocorrido_em", { ascending: false })
      .limit(50);
    if (error) throw error;
    return data;
  },
};
