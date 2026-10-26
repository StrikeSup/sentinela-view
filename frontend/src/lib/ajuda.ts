import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/** Cliente sem tipos gerados: as tabelas da ajuda são novas. */
const db = supabase as unknown as SupabaseClient;

export type AjudaTela = {
  id: string;
  rota: string;
  titulo: string;
  resumo: string | null;
  categoria: string;
  ordem: number;
};

export type AjudaPasso = {
  id: string;
  tela_id: string;
  ordem: number;
  titulo: string;
  texto: string;
  seletor: string | null;
  posicao: string;
  imagem_url: string | null;
};

const CAMPOS_TELA = "id, rota, titulo, resumo, categoria, ordem";
const CAMPOS_PASSO = "id, tela_id, ordem, titulo, texto, seletor, posicao, imagem_url";

export async function listarTelas(): Promise<AjudaTela[]> {
  const { data, error } = await db
    .from("ajuda_telas")
    .select(CAMPOS_TELA)
    .order("ordem", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as AjudaTela[];
}

export async function listarPassos(telaId: string): Promise<AjudaPasso[]> {
  const { data, error } = await db
    .from("ajuda_passos")
    .select(CAMPOS_PASSO)
    .eq("tela_id", telaId)
    .order("ordem", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as AjudaPasso[];
}

export async function listarTodosPassos(): Promise<AjudaPasso[]> {
  const { data, error } = await db
    .from("ajuda_passos")
    .select(CAMPOS_PASSO)
    .order("ordem", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as AjudaPasso[];
}

/** Garante que a tela atual tenha um registro de ajuda. */
export async function garantirTela(
  rota: string,
  titulo: string,
  categoria = "Geral",
): Promise<AjudaTela> {
  const { data } = await db.from("ajuda_telas").select(CAMPOS_TELA).eq("rota", rota).maybeSingle();
  if (data) return data as AjudaTela;
  const { data: nova, error } = await db
    .from("ajuda_telas")
    .insert({ rota, titulo, categoria })
    .select(CAMPOS_TELA)
    .single();
  if (error) throw new Error(error.message);
  return nova as AjudaTela;
}

export async function salvarTela(tela: Partial<AjudaTela> & { id: string }) {
  const { error } = await db
    .from("ajuda_telas")
    .update({
      titulo: tela.titulo,
      resumo: tela.resumo,
      categoria: tela.categoria,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tela.id);
  if (error) throw new Error(error.message);
}

export async function criarPasso(telaId: string, ordem: number): Promise<AjudaPasso> {
  const { data, error } = await db
    .from("ajuda_passos")
    .insert({ tela_id: telaId, ordem, titulo: "Novo passo", texto: "" })
    .select(CAMPOS_PASSO)
    .single();
  if (error) throw new Error(error.message);
  return data as AjudaPasso;
}

export async function salvarPasso(passo: AjudaPasso) {
  const { error } = await db
    .from("ajuda_passos")
    .update({
      ordem: passo.ordem,
      titulo: passo.titulo,
      texto: passo.texto,
      seletor: passo.seletor,
      posicao: passo.posicao,
      imagem_url: passo.imagem_url,
      updated_at: new Date().toISOString(),
    })
    .eq("id", passo.id);
  if (error) throw new Error(error.message);
}

export async function excluirPasso(id: string) {
  const { error } = await db.from("ajuda_passos").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Envia um print (colado com Ctrl+V ou escolhido) e devolve o endereço público. */
export async function enviarImagem(arquivo: Blob, nomeBase = "print"): Promise<string> {
  const ext = (arquivo.type.split("/")[1] || "png").replace("jpeg", "jpg");
  const caminho = `${nomeBase}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from("ajuda")
    .upload(caminho, arquivo, { contentType: arquivo.type || "image/png", upsert: false });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from("ajuda").getPublicUrl(caminho);
  return data.publicUrl;
}

/** Caminho curto e estável para destacar um elemento da tela. */
export function seletorDoElemento(el: Element): string {
  const campo = el.closest("input, textarea, select, button, [role=\"combobox\"]");
  const marcado = (campo ?? el).closest("[data-ajuda]");
  if (marcado) return `[data-ajuda="${marcado.getAttribute("data-ajuda")}"]`;
  const partes: string[] = [];
  const janela = el.closest('[role="dialog"]');
  let atual: Element | null = campo ?? el;
  while (atual && atual !== document.body && partes.length < 12) {
    if (janela && atual === janela) {
      partes.unshift('[role="dialog"]');
      break;
    }
    if (atual.id && !/^radix-/.test(atual.id)) {
      partes.unshift(`#${CSS.escape(atual.id)}`);
      break;
    }
    const pai: Element | null = atual.parentElement;
    if (!pai) break;
    const irmaos = Array.from(pai.children).filter((c) => c.tagName === atual!.tagName);
    const indice = irmaos.indexOf(atual) + 1;
    partes.unshift(`${atual.tagName.toLowerCase()}:nth-of-type(${indice})`);
    atual = pai;
  }
  return partes.join(" > ");
}
