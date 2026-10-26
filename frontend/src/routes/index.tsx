import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sentinela VIEW | Monitoramento em tempo real" },
      {
        name: "description",
        content: "Acesse o Sentinela VIEW para monitorar câmeras, servidores e operações em tempo real.",
      },
      { property: "og:title", content: "Sentinela VIEW | Monitoramento em tempo real" },
      {
        property: "og:description",
        content: "Acesse o Sentinela VIEW para monitorar câmeras, servidores e operações em tempo real.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
  component: () => null,
});
