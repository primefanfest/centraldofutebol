import { mkdir, writeFile } from "node:fs/promises";

const CHAVE = process.env.API_FOOTBALL_KEY;
if (!CHAVE) throw new Error("O secret API_FOOTBALL_KEY não foi configurado no GitHub.");

const BASE = "https://v3.football.api-sports.io";
const FUSO = "America/Sao_Paulo";
const CAMPEONATOS = [
  { id: 71, nome: "Brasileirão — Série A" },
  { id: 72, nome: "Brasileirão — Série B" },
  { id: 73, nome: "Copa do Brasil" },
  { id: 13, nome: "Libertadores" },
  { id: 11, nome: "Sul-Americana" }
];

const pad = n => String(n).padStart(2, "0");
const dataLocal = (d = new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit"
}).format(d);
const inicio = dataLocal();
const fimData = new Date();
fimData.setDate(fimData.getDate() + 7);
const fim = dataLocal(fimData);
const temporada = Number(inicio.slice(0, 4));

const nomes = new Map([
  ["Atletico-MG", "Atlético Mineiro"], ["Atletico Mineiro", "Atlético Mineiro"],
  ["Athletico Paranaense", "Athletico-PR"], ["Atletico Paranaense", "Athletico-PR"],
  ["RB Bragantino", "Red Bull Bragantino"], ["Bragantino", "Red Bull Bragantino"],
  ["Vasco DA Gama", "Vasco"], ["Vasco da Gama", "Vasco"],
  ["Vitoria", "Vitória"], ["Gremio", "Grêmio"], ["Sao Paulo", "São Paulo"]
]);
const nomeTime = nome => nomes.get(nome) || nome;
const status = codigo => ({
  "NS":"Agendado","TBD":"A definir","PST":"Adiado","CANC":"Cancelado","SUSP":"Suspenso",
  "INT":"Interrompido","1H":"Ao vivo","HT":"Intervalo","2H":"Ao vivo","ET":"Prorrogação",
  "BT":"Intervalo","P":"Pênaltis","LIVE":"Ao vivo","FT":"Encerrado","AET":"Encerrado","PEN":"Encerrado",
  "AWD":"Encerrado","WO":"W.O."
}[codigo] || codigo || "Agendado");

async function consultar(campeonato) {
  const url = new URL("/fixtures", BASE);
  url.searchParams.set("league", campeonato.id);
  url.searchParams.set("season", temporada);
  url.searchParams.set("from", inicio);
  url.searchParams.set("to", fim);
  url.searchParams.set("timezone", FUSO);
  const resposta = await fetch(url, { headers: { "x-apisports-key": CHAVE, Accept: "application/json" } });
  if (!resposta.ok) throw new Error(`${campeonato.nome}: HTTP ${resposta.status}`);
  const dados = await resposta.json();
  if (dados.errors && Object.keys(dados.errors).length) throw new Error(`${campeonato.nome}: ${JSON.stringify(dados.errors)}`);
  return (dados.response || []).map(item => {
    const data = item.fixture.date;
    const horario = new Intl.DateTimeFormat("pt-BR", { timeZone:FUSO, hour:"2-digit", minute:"2-digit", hour12:false }).format(new Date(data));
    const encerrado = ["FT","AET","PEN","AWD","WO"].includes(item.fixture.status.short);
    return {
      id: item.fixture.id,
      data,
      campeonato: campeonato.nome,
      mandante: nomeTime(item.teams.home.name),
      visitante: nomeTime(item.teams.away.name),
      horario,
      estadio: item.fixture.venue?.name || "Estádio a definir",
      cidade: item.fixture.venue?.city || "Cidade a definir",
      status: status(item.fixture.status.short),
      gols: encerrado && item.goals.home != null && item.goals.away != null ? { mandante:item.goals.home, visitante:item.goals.away } : null,
      fonte: "API-Football"
    };
  });
}

const resultados = await Promise.allSettled(CAMPEONATOS.map(consultar));
const erros = resultados.filter(r => r.status === "rejected").map(r => r.reason.message);
const jogos = resultados.flatMap(r => r.status === "fulfilled" ? r.value : []).sort((a,b) => new Date(a.data)-new Date(b.data));
if (!jogos.length && erros.length) throw new Error(`Nenhum campeonato atualizado: ${erros.join(" | ")}`);

await mkdir("dados", { recursive:true });
await writeFile("dados/jogos.json", JSON.stringify({ atualizadoEm:new Date().toISOString(), periodo:{ inicio, fim }, jogos, avisos:erros }, null, 2));
console.log(`${jogos.length} partidas atualizadas. Período: ${inicio} a ${fim}.`);
if (erros.length) console.warn(`Avisos: ${erros.join(" | ")}`);
