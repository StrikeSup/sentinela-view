/**
 * Leitura de arquivos CSV exportados de outros sistemas (DGUARD, DIGIFORT)
 * para cadastro de DVRs em massa.
 */

export type TipoImportacao = "dguard" | "digifort" | "modelo";

export type CampoDvr =
  | "nome"
  | "fabricante"
  | "modelo"
  | "canais"
  | "usuario"
  | "senha"
  | "ip_interno"
  | "porta_http_interna"
  | "porta_rtsp_interna"
  | "ip_externo"
  | "porta_http_externa"
  | "cloud"
  | "porta_http_cloud"
  | "porta_cloud";

export const CAMPOS: { campo: CampoDvr; rotulo: string; obrigatorio?: boolean }[] = [
  { campo: "nome", rotulo: "Nome do DVR", obrigatorio: true },
  { campo: "ip_interno", rotulo: "IP interno" },
  { campo: "porta_http_interna", rotulo: "Porta HTTP interna" },
  { campo: "porta_rtsp_interna", rotulo: "Porta RTSP interna" },
  { campo: "ip_externo", rotulo: "IP externo" },
  { campo: "porta_http_externa", rotulo: "Porta HTTP externa" },
  { campo: "cloud", rotulo: "Cloud (endereço)" },
  { campo: "porta_http_cloud", rotulo: "Porta HTTP cloud" },
  { campo: "porta_cloud", rotulo: "Porta serviço cloud" },
  { campo: "usuario", rotulo: "Usuário" },
  { campo: "senha", rotulo: "Senha" },
  { campo: "canais", rotulo: "Quantidade de câmeras" },
  { campo: "fabricante", rotulo: "Fabricante" },
  { campo: "modelo", rotulo: "Modelo" },
];

/** Nomes de coluna conhecidos de cada sistema (comparados sem acento/caixa). */
const ALIASES: Record<TipoImportacao, Record<CampoDvr, string[]>> = {
  dguard: {
    nome: ["nome", "nome do dispositivo", "dispositivo", "descricao", "name", "servidor"],
    fabricante: ["fabricante", "marca", "manufacturer"],
    modelo: ["modelo", "model", "tipo de dispositivo"],
    canais: ["canais", "cameras", "qtd cameras", "numero de canais", "channels"],
    usuario: ["usuario", "login", "user", "username"],
    senha: ["senha", "password", "pass"],
    ip_interno: ["ip", "ip interno", "endereco", "endereco ip", "host", "address"],
    porta_http_interna: ["porta", "porta http", "porta interna", "port"],
    porta_rtsp_interna: ["porta rtsp", "rtsp"],
    ip_externo: ["ip externo", "ip publico", "dns", "host externo"],
    porta_http_externa: ["porta externa", "porta http externa"],
    cloud: ["cloud", "endereco cloud", "ddns", "p2p"],
    porta_http_cloud: ["porta http cloud", "porta cloud http"],
    porta_cloud: ["porta cloud", "porta servico cloud", "porta de servico cloud"],
  },
  modelo: {
    nome: ["nome do dvr", "nome"],
    fabricante: ["fabricante"],
    modelo: ["modelo"],
    canais: ["quantidade de cameras", "canais", "cameras"],
    usuario: ["usuario"],
    senha: ["senha"],
    ip_interno: ["ip interno", "ip"],
    porta_http_interna: ["porta http interna", "porta http"],
    porta_rtsp_interna: ["porta rtsp interna", "porta rtsp"],
    ip_externo: ["ip externo"],
    porta_http_externa: ["porta http externa", "porta externa"],
    cloud: ["cloud endereco", "cloud"],
    porta_http_cloud: ["porta http cloud"],
    porta_cloud: ["porta servico cloud", "porta cloud"],
  },
  digifort: {
    nome: ["nome", "name", "camera", "descricao", "description", "device"],
    fabricante: ["fabricante", "manufacturer", "marca"],
    modelo: ["modelo", "model"],
    canais: ["canais", "channels", "cameras", "qtd cameras"],
    usuario: ["usuario", "user", "username", "login"],
    senha: ["senha", "password"],
    ip_interno: ["ip", "endereco", "address", "host", "ip interno"],
    porta_http_interna: ["porta", "port", "porta http", "http port"],
    porta_rtsp_interna: ["porta rtsp", "rtsp port", "rtsp"],
    ip_externo: ["ip externo", "external address", "dns"],
    porta_http_externa: ["porta externa", "external port"],
    cloud: ["cloud", "ddns", "p2p"],
    porta_http_cloud: ["porta http cloud"],
    porta_cloud: ["porta cloud", "porta servico cloud"],
  },
};

const normalizar = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function detectarSeparador(linha: string) {
  const candidatos = [";", ",", "\t", "|"];
  let melhor = ";";
  let maior = -1;
  for (const c of candidatos) {
    const n = linha.split(c).length;
    if (n > maior) {
      maior = n;
      melhor = c;
    }
  }
  return melhor;
}

export type TabelaCsv = { colunas: string[]; linhas: string[][] };

/** Lê um CSV simples com aspas duplas e separador detectado automaticamente. */
export function lerCsv(texto: string): TabelaCsv {
  const limpo = texto.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const primeira = limpo.split("\n").find((l) => l.trim() !== "") ?? "";
  const sep = detectarSeparador(primeira);

  const linhas: string[][] = [];
  let campo = "";
  let atual: string[] = [];
  let aspas = false;

  for (let i = 0; i < limpo.length; i++) {
    const c = limpo[i]!;
    if (aspas) {
      if (c === '"') {
        if (limpo[i + 1] === '"') {
          campo += '"';
          i++;
        } else aspas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') {
      aspas = true;
continue;
    }
    if (c === sep) {
      atual.push(campo.trim());
      campo = "";
      continue;
    }
    if (c === "\n") {
      atual.push(campo.trim());
      if (atual.some((x) => x !== "")) linhas.push(atual);
      atual = [];
      campo = "";
      continue;
    }
    campo += c;
  }
  atual.push(campo.trim());
  if (atual.some((x) => x !== "")) linhas.push(atual);

  const colunas = linhas.shift() ?? [];
  return { colunas, linhas };
}

/** Campos preenchidos automaticamente ao abrir o arquivo. */
const PADRAO: CampoDvr[] = ["nome", "ip_interno", "usuario", "senha"];

/** Sugere qual coluna do arquivo corresponde a cada campo do DVR. */
export function sugerirMapeamento(
  tipo: TipoImportacao,
  colunas: string[],
): Record<CampoDvr, string> {
  const normalizadas = colunas.map((c) => normalizar(c));
  const mapa = {} as Record<CampoDvr, string>;
  for (const { campo } of CAMPOS) {
    // Na planilha modelo todas as colunas são conhecidas: preenche tudo.
    if (tipo !== "modelo" && !PADRAO.includes(campo)) {
      mapa[campo] = "";
      continue;
    }
    const alvos = ALIASES[tipo][campo];
    let indice = normalizadas.findIndex((c) => alvos.includes(c));
    if (indice < 0) indice = normalizadas.findIndex((c) => alvos.some((a) => c.includes(a)));
    mapa[campo] = indice >= 0 ? colunas[indice]! : "";
  }
  return mapa;
}

/** Colunas e exemplo da planilha modelo do Sentinela. */
export const COLUNAS_MODELO = [
  "Nome do DVR",
  "IP interno",
  "Porta HTTP interna",
  "Porta RTSP interna",
  "IP externo",
  "Porta HTTP externa",
  "Cloud (endereço)",
  "Porta HTTP cloud",
  "Porta serviço cloud",
  "Usuário",
  "Senha",
  "Quantidade de câmeras",
  "Fabricante",
  "Modelo",
];

const EXEMPLOS_MODELO = [
  ["DVR RECEPÇÃO", "192.168.0.50", "80", "554", "", "", "", "", "", "admin", "", "16", "Intelbras", "MHDX 3116"],
  ["DVR ESTOQUE", "192.168.0.51", "80", "554", "", "", "", "", "", "admin", "", "8", "Hikvision", "DS-7208"],
];

/** Gera o conteúdo CSV do modelo (separador ; e BOM para abrir no Excel). */
export function csvModelo(): string {
  const linhas = [COLUNAS_MODELO, ...EXEMPLOS_MODELO].map((l) =>
    l.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(";"),
  );
  return `\uFEFF${linhas.join("\n")}\n`;
}

/** Arquivos exportados costumam vir em Windows-1252; detecta e converte. */
export function decodificar(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}


export type LinhaDvr = {
  nome: string;
  fabricante: string | null;
  modelo: string | null;
  canais: number;
  usuario: string | null;
  senha: string | null;
  ip_interno: string | null;
  porta_http_interna: number | null;
  porta_rtsp_interna: number | null;
  ip_externo: string | null;
  porta_http_externa: number | null;
  cloud: string | null;
  porta_http_cloud: number | null;
  porta_cloud: number | null;
  erro?: string | undefined;
};

const inteiro = (v: string | undefined) => {
  const n = Number(String(v ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Converte as linhas do arquivo em DVRs prontos para gravar. */
export function montarDvrs(
  tabela: TabelaCsv,
  mapa: Record<CampoDvr, string>,
): LinhaDvr[] {
  const indice = (campo: CampoDvr) => tabela.colunas.indexOf(mapa[campo] ?? "");
  return tabela.linhas.map((linha) => {
    const ler = (campo: CampoDvr) => {
      const i = indice(campo);
      return i >= 0 ? (linha[i] ?? "").trim() : "";
    };
    const nome = ler("nome");
    const canais = inteiro(ler("canais")) ?? 0;
    return {
      nome,
      fabricante: ler("fabricante") || null,
      modelo: ler("modelo") || null,
      canais,
      usuario: ler("usuario") || null,
      senha: ler("senha") || null,
      ip_interno: ler("ip_interno") || null,
      porta_http_interna: inteiro(ler("porta_http_interna")),
      porta_rtsp_interna: inteiro(ler("porta_rtsp_interna")),
      ip_externo: ler("ip_externo") || null,
      porta_http_externa: inteiro(ler("porta_http_externa")),
      cloud: ler("cloud") || null,
      porta_http_cloud: inteiro(ler("porta_http_cloud")),
      porta_cloud: inteiro(ler("porta_cloud")),
      erro: !nome ? "Sem nome" : undefined,
    };
  });
}
