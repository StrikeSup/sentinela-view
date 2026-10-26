import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";

type Props = {
  tabela: "fabricantes" | "sistemas";
  query: { queryKey: string[]; queryFn: () => Promise<{ id: string; nome: string }[]> };
  rotulo: string;
  vazioTexto: string;
};

export function ListaCadastro({ tabela: nomeTabela, query, rotulo, vazioTexto }: Props) {
  const qc = useQueryClient();
  const lista = useQuery(query);
  const [novo, setNovo] = useState("");
  const [editando, setEditando] = useState<{ id: string; nome: string } | null>(null);
  const tabela = () => supabase.from(nomeTabela as never) as any;
  const recarregar = () => qc.invalidateQueries({ queryKey: query.queryKey });

  const salvar = useMutation({
    mutationFn: async (f: { id?: string; nome: string }) => {
      const nome = f.nome.trim();
      if (!nome) throw new Error("Informe o nome");
      const { error } = f.id
        ? await tabela().update({ nome }).eq("id", f.id)
        : await tabela().insert({ nome });
      if (error) throw new Error(error.code === "23505" ? `${rotulo} já cadastrado` : error.message);
    },
    onSuccess: () => {
      toast.success(`${rotulo} salvo`);
      setNovo("");
      setEditando(null);
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await tabela().delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`${rotulo} excluído`);
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
        <CardContent className="space-y-4 pt-6">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              salvar.mutate({ nome: novo });
            }}
          >
            <Input placeholder={`Nome do ${rotulo.toLowerCase()}`} value={novo} onChange={(e) => setNovo(e.target.value)} />
            <Button type="submit" disabled={salvar.isPending}>
              <Plus className="mr-1 h-4 w-4" /> Adicionar
            </Button>
          </form>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{rotulo}</TableHead>
                <TableHead className="w-32 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(lista.data ?? []).map((f) => (
                <TableRow key={f.id}>
                  <TableCell>
                    {editando?.id === f.id ? (
                      <Input
                        autoFocus
                        value={editando.nome}
                        onChange={(e) => setEditando({ id: f.id, nome: e.target.value })}
                        onKeyDown={(e) => e.key === "Enter" && salvar.mutate(editando)}
                      />
                    ) : (
                      f.nome
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {editando?.id === f.id ? (
                      <>
                        <Button size="icon" variant="ghost" onClick={() => salvar.mutate(editando)}>
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setEditando(null)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="icon" variant="ghost" onClick={() => setEditando({ id: f.id, nome: f.nome })}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => confirm(`Excluir ${f.nome}?`) && excluir.mutate(f.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {lista.data?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-muted-foreground">
                    {vazioTexto}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
    </Card>
  );
}
