import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Download, MonitorDown, ShieldAlert, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/downloads")({
  head: () => ({
    meta: [
      { title: "Downloads — Sentinela VIEW" },
      { name: "description", content: "Baixe o aplicativo Sentinela VIEW para Windows." },
      { property: "og:title", content: "Downloads — Sentinela VIEW" },
      { property: "og:description", content: "Baixe o aplicativo Sentinela VIEW para Windows." },
    ],
  }),
  component: Downloads,
});

type VersaoApp = {
  versao: string;
  tamanho: string;
};

type VersaoAgent = {
  versao: string;
  tamanho: string;
  runtimeBundled: boolean;
};

function Downloads() {
  const [versaoApp, setVersaoApp] = useState<VersaoApp | null>(null);
  const [versaoAgent, setVersaoAgent] = useState<VersaoAgent | null>(null);

  useEffect(() => {
    fetch("/api/public/v1/app-desktop")
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        if (!info?.versao) return;
        setVersaoApp({
          versao: info.versao,
          tamanho: `${(info.instalador?.tamanho / 1024 / 1024).toFixed(0)} MB`,
        });
      })
      .catch(() => {});
    fetch("/api/public/v1/agent-desktop")
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        if (typeof info?.version !== "string" || !Number.isFinite(info?.size)) return;
        setVersaoAgent({
          versao: info.version,
          tamanho: `${(info.size / 1024 / 1024).toFixed(0)} MB`,
          runtimeBundled: info.runtimeBundled === true,
        });
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      <PageHeader title="Downloads" description="Baixe o Sentinela VIEW e o Sentinela Servidor." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col gap-4 p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-primary/10 p-3 text-primary">
                <MonitorDown className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="font-medium">Sentinela VIEW para Windows</p>
                <p className="text-xs text-muted-foreground">
                  Versão {versaoApp?.versao ?? "1.2.0"} · {versaoApp?.tamanho ?? "≈ 110 MB"}
                </p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Aplicativo de desktop com janela própria, telas extras em monitores separados e vídeo
              que não pausa com a janela minimizada e câmeras em H.265 sem conversão. A partir desta
              versão, o aplicativo se atualiza sozinho: quando sair uma versão nova, ele baixa e
              aplica na próxima abertura, sem precisar instalar de novo.
            </p>
            <Button asChild className="w-full">
              <a href="/api/public/v1/app-desktop/download" download="Sentinela-VIEW-Windows.zip">
                <Download className="mr-2 h-4 w-4" /> Baixar
              </a>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-4 p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-primary/10 p-3 text-primary">
                <RefreshCw className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="font-medium">Sentinela Servidor (Agent)</p>
                <p className="text-xs text-muted-foreground">
                  {versaoAgent
                    ? `Versão ${versaoAgent.versao} · ${versaoAgent.tamanho}`
                    : "Nenhuma versão publicada"}
                </p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Programa instalado no servidor do cliente que conecta os DVRs ao Sentinela e envia o
              vídeo das câmeras.{" "}
              {versaoAgent?.runtimeBundled
                ? "O instalador inclui o Agent, o .NET 8 e as ferramentas necessárias para o vídeo."
                : "Esta versão requer o .NET 8 Desktop Runtime x64 instalado no servidor."}
            </p>
            {versaoAgent ? (
              <Button asChild className="w-full">
                <a
                  href="/api/public/v1/agent-desktop/download"
                  download="Sentinela-Agent-Setup.exe"
                >
                  <Download className="mr-2 h-4 w-4" /> Baixar instalador
                </a>
              </Button>
            ) : (
              <Button className="w-full" disabled>
                Download indisponível
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardContent className="flex items-start gap-3 p-5">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Como instalar</p>
            <p className="mt-1">
              Descompacte o arquivo baixado e abra o <strong>Sentinela VIEW.exe</strong>. Na
              primeira execução o Windows pode mostrar um aviso de segurança: clique em{" "}
              <strong>Mais informações</strong> e depois em <strong>Executar assim mesmo</strong>.
            </p>
            <p className="mt-2">
              Para instalar o Agent, execute <strong>Sentinela-Agent-Setup.exe</strong> no servidor
              Windows.
              {versaoAgent?.runtimeBundled
                ? " O instalador já inclui o .NET 8."
                : " Se necessário, instale antes o .NET 8 Desktop Runtime x64."}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
