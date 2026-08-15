import { mkdir, readFile, writeFile } from "node:fs/promises";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const FUSO = "America/Sao_Paulo";
const CAMPEONATOS = [
  { slug: "bra.1", nome: "Brasileirão — Série A" },
  { slug: "bra.2", nome: "Brasileirão — Série B" },
  { slug: "bra.copa_do_brazil", nome: "Copa do Brasil" },
  { slug: "conmebol.libertadores", nome: "Libertadores" },
  { slug: "conmebol.sudamericana", nome: "Sul-Americana" }
];

const formatoData = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit"
});
const dataLocal = data => formatoData.format(data);
const hoje = new Date();
const limite = new Date(hoje);
limite.setDate(limite.getDate() + 7);
const inicio = dataLocal(hoje);
const fim = dataLocal(limite);
const intervaloEspn = `${inicio.replaceAll("-", "")}-${fim.replaceAll("-", "")}`;

const nomes = new Map([
  ["Atlético-MG", "Atlético Mineiro"], ["Atletico-MG", "Atlético Mineiro"],
  ["Athletico Paranaense", "Athletico-PR"], ["Athletico-PR", "Athletico-PR"],
  ["Bragantino", "Red Bull Bragantino"], ["RB Bragantino", "Red Bull Bragantino"],
  ["Vasco da Gama", "Vasco"], ["Gremio", "Grêmio"], ["Sao Paulo", "São Paulo"]
]);
const nomeTime = nome => nomes.get(nome) || nome || "Time a definir";

function situacao(tipo = {}) {
  if (tipo.state === "in") return tipo.description || "Ao vivo";
  if (tipo.completed || tipo.state === "post") return "Encerrado";
  const texto = String(tipo.description || tipo.detail || "").toLowerCase();
  if (texto.includes("postpon")) return "Adiado";
  if (texto.includes("cancel")) return "Cancelado";
  if (texto.includes("suspend")) return "Suspenso";
  return "Agendado";
}

function normalizar(evento, campeonato) {
  const disputa = evento.competitions?.[0] || {};
  const participantes = disputa.competitors || [];
  const casa = participantes.find(item => item.homeAway === "home") || participantes[0] || {};
  const fora = participantes.find(item => item.homeAway === "away") || participantes[1] || {};
  const encerrado = Boolean(evento.status?.type?.completed || evento.status?.type?.state === "post");
  const data = evento.date || disputa.date;
  if (!data || !casa.team || !fora.team) return null;
  const horario = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO, hour: "2-digit", minute: "2-digit", hour12: false
  }).format(new Date(data));
  const endereco = disputa.venue?.address || {};
  const cidade = [endereco.city, endereco.state].filter(Boolean).join(" - ") || "Cidade a definir";
  return {
    id: evento.id,
    data,
    campeonato: campeonato.nome,
    mandante: nomeTime(casa.team.displayName || casa.team.name),
    visitante: nomeTime(fora.team.displayName || fora.team.name),
    horario,
    estadio: disputa.venue?.fullName || "Estádio a definir",
    cidade,
    status: situacao(evento.status?.type),
    gols: encerrado && casa.score != null && fora.score != null
      ? { mandante: Number(casa.score), visitante: Number(fora.score) }
      : null,
    fonte: "ESPN"
  };
}

async function consultar(campeonato) {
  const url = new URL(`${BASE}/${campeonato.slug}/scoreboard`);
  url.searchParams.set("dates", intervaloEspn);
  url.searchParams.set("limit", "100");
  url.searchParams.set("region", "br");
  url.searchParams.set("lang", "pt");
  const resposta = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "PainelFutebolAbleSign/1.0" }
  });
  if (!resposta.ok) throw new Error(`${campeonato.nome}: HTTP ${resposta.status}`);
  const dados = await resposta.json();
  return (dados.events || []).map(evento => normalizar(evento, campeonato)).filter(Boolean);
}

async function anteriores() {
  try {
    const dados = JSON.parse(await readFile("dados/jogos.json", "utf8"));
    return Array.isArray(dados.jogos) ? dados.jogos : [];
  } catch {
    return [];
  }
}

const jogosAnteriores = await anteriores();
const resultados = await Promise.allSettled(CAMPEONATOS.map(consultar));
const avisos = [];
const jogos = [];

resultados.forEach((resultado, indice) => {
  const campeonato = CAMPEONATOS[indice];
  if (resultado.status === "fulfilled") {
    jogos.push(...resultado.value);
  } else {
    avisos.push(resultado.reason?.message || `${campeonato.nome}: falha desconhecida`);
    jogos.push(...jogosAnteriores.filter(jogo => jogo.campeonato === campeonato.nome));
  }
});

const inicioMs = new Date(`${inicio}T00:00:00-03:00`).getTime();
const fimMs = new Date(`${fim}T23:59:59-03:00`).getTime();
const unicos = [...new Map(jogos
  .filter(jogo => {
    const instante = new Date(jogo.data).getTime();
    return instante >= inicioMs && instante <= fimMs;
  })
  .map(jogo => [String(jogo.id || `${jogo.data}-${jogo.mandante}-${jogo.visitante}`), jogo])).values()]
  .sort((a, b) => new Date(a.data) - new Date(b.data));

if (!unicos.length && avisos.length === CAMPEONATOS.length) {
  throw new Error(`A ESPN não respondeu e nenhum dado anterior pôde ser preservado: ${avisos.join(" | ")}`);
}

await mkdir("dados", { recursive: true });
await writeFile("dados/jogos.json", JSON.stringify({
  atualizadoEm: new Date().toISOString(),
  periodo: { inicio, fim },
  jogos: unicos,
  avisos
}, null, 2));

console.log(`${unicos.length} partidas publicadas. Período: ${inicio} a ${fim}.`);
if (avisos.length) console.warn(`Dados anteriores preservados em consultas com falha: ${avisos.join(" | ")}`);
