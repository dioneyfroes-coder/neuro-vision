import type { Caixa, EntradaLog } from "../src/types";
import { colapsarRepeticoes } from "../src/texto";
import { entradaDeResultado } from "../src/percepcao";
import type { MotorPercepcao, ResultadoPercepcao } from "../src/percepcao";
import { RastreadorObjetos } from "../src/rastreamento";
import { DetectorMudancaDeCena } from "../src/cena";
import { ehCancelamento } from "../src/erros";
import { AgendadorAnalise } from "./scheduler";
import * as api from "./api";
import { DetectorObjetos } from "./detector";
import { Camera, ErroCamera } from "./camera";
import { MotorDeteccao, MotorOllama } from "./motores";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Elemento #${id} nao encontrado`);
  return node as T;
}

const video = el<HTMLVideoElement>("video");
const overlay = el<HTMLCanvasElement>("overlay");
const maybeCtx = overlay.getContext("2d");
if (!maybeCtx) throw new Error("Canvas 2D indisponivel");
const ctx = maybeCtx;
const camera = new Camera(video);

const placeholder = el<HTMLDivElement>("placeholder");
const statusEl = el<HTMLDivElement>("status");
const spinnerEl = el<HTMLDivElement>("spinner");
const ollamaStatusEl = el<HTMLSpanElement>("ollamaStatus");
const logEl = el<HTMLUListElement>("log");
const logCountEl = el<HTMLSpanElement>("logCount");
const clearLogBtn = el<HTMLButtonElement>("clearLog");
const exportBtn = el<HTMLButtonElement>("exportLog");
const filterInput = el<HTMLInputElement>("filter");
const startBtn = el<HTMLButtonElement>("start");
const stopBtn = el<HTMLButtonElement>("stop");
const modelSelect = el<HTMLSelectElement>("model");
const motorSelect = el<HTMLSelectElement>("motor");
const intervalInput = el<HTMLInputElement>("interval");
const intervalValue = el<HTMLSpanElement>("intervalValue");
const thresholdInput = el<HTMLInputElement>("threshold");
const thresholdValue = el<HTMLSpanElement>("thresholdValue");

const detectorCoco = new DetectorObjetos();
const rastreador = new RastreadorObjetos();
const detectorCena = new DetectorMudancaDeCena();
let motorAtual: MotorPercepcao | null = null;
let running = false;
let controller: AbortController | null = null;
let ultimaDescricao = "";
let ultimaDuracaoMs = 0;
let roteiroBeats: string[] = [];
let roteiroPrimeiro = true;
let intervaloMsConfigurado = Number(intervalInput.value) * 1000;

const agendador = new AgendadorAnalise({
  executar: () => analisar(),
  obterIntervaloMs: () => intervaloMsConfigurado,
  obterUltimaDuracaoMs: () => ultimaDuracaoMs,
});

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function setSpinner(ativo: boolean): void {
  spinnerEl.hidden = !ativo;
}

function drawBoxes(objetos: ReadonlyArray<{ nome: string; score: number; caixa: Caixa }>): void {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.lineWidth = 3;
  ctx.font = "16px 'Segoe UI', sans-serif";
  ctx.textBaseline = "top";

  for (const o of objetos) {
    const { xmin, ymin, xmax, ymax } = o.caixa;
    ctx.strokeStyle = "#4f9cf9";
    ctx.strokeRect(xmin, ymin, xmax - xmin, ymax - ymin);

    const label = `${o.nome} ${(o.score * 100).toFixed(0)}%`;
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = "#4f9cf9";
    ctx.fillRect(xmin, ymin, textWidth + 12, 22);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, xmin + 6, ymin + 3);
  }
}

function atualizarContagem(): void {
  const total = logEl.children.length;
  logCountEl.textContent = String(total);
  clearLogBtn.disabled = total === 0;
  exportBtn.disabled = total === 0;
}

function criarItem(entry: EntradaLog): HTMLLIElement {
  const li = document.createElement("li");

  if (entry.snapshot) {
    const img = document.createElement("img");
    img.className = "thumb";
    img.src = entry.snapshot;
    img.alt = "frame capturado";
    img.loading = "lazy";
    li.appendChild(img);
  }

  const corpo = document.createElement("div");
  corpo.className = "corpo";

  const cabecalho = document.createElement("div");
  cabecalho.className = "cabecalho";
  const time = document.createElement("span");
  time.className = "time";
  time.textContent = new Date(entry.timestamp).toLocaleTimeString("pt-BR");
  cabecalho.appendChild(time);
  if (entry.modelo) {
    const meta = document.createElement("span");
    meta.className = "meta";
    let texto = entry.modelo;
    if (entry.ms && entry.tokens) {
      const tokS = Math.round(entry.tokens / (entry.ms / 1000));
      texto += ` · ${entry.tokens} toks em ${Math.round(entry.ms / 1000)}s (${tokS} tok/s)`;
    }
    meta.textContent = texto;
    cabecalho.appendChild(meta);
  }
  corpo.appendChild(cabecalho);

  const objs = document.createElement("div");
  objs.className = "objs";
  if (entry.tipo === "descricao" || entry.tipo === "roteiro") {
    if (entry.tipo === "roteiro") {
      const badge = document.createElement("span");
      badge.className = "tag papel";
      badge.textContent = entry.papel === "base" ? "roteiro base" : "roteiro +";
      objs.appendChild(badge);
    }
    const span = document.createElement("span");
    span.className = "desc";
    span.textContent = entry.resumo;
    objs.appendChild(span);
  } else if (entry.objetos.length === 0) {
    const span = document.createElement("span");
    span.className = "empty";
    span.textContent = "nada reconhecido";
    objs.appendChild(span);
  } else {
    for (const o of entry.objetos) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = `${o.nome} ${(o.score * 100).toFixed(0)}%`;
      objs.appendChild(tag);
    }
  }
  corpo.appendChild(objs);
  li.appendChild(corpo);
  return li;
}

function addLogEntry(entry: EntradaLog): void {
  logEl.prepend(criarItem(entry));
  atualizarContagem();
}

function limparLista(): void {
  logEl.replaceChildren();
}

async function carregarHistorico(): Promise<void> {
  try {
    const entradas = await api.listarEntradas(100);
    logEl.replaceChildren(...entradas.map(criarItem));
    atualizarContagem();
  } catch {
    // historico indisponivel; segue vazio
  }
}

async function limparHistorico(): Promise<void> {
  clearLogBtn.disabled = true;
  try {
    await api.limparHistorico();
    limparLista();
    atualizarContagem();
    setStatus("Historico limpo.");
  } catch (err) {
    setStatus(`Falha ao limpar historico: ${(err as Error).message}`);
    atualizarContagem();
  }
}

async function analisarComOllama(signal: AbortSignal, ehRoteiro: boolean): Promise<void> {
  const dataUrl = camera.capturarFrame(512);
  if (dataUrl === null) return;
  const width = camera.largura;
  const height = camera.altura;
  overlay.width = width;
  overlay.height = height;
  ctx.clearRect(0, 0, width, height);

  const base64 = dataUrl.split(",")[1] ?? "";
  setStatus("Ollama analisando frame... (pode demorar)");

  const motor = new MotorOllama({
    modo: ehRoteiro ? "roteiro" : "descricao",
    roteiro: ehRoteiro ? roteiroBeats.slice(-8).join(" ").slice(0, 1200) : undefined,
    base: ehRoteiro ? roteiroPrimeiro : undefined,
    anterior: ehRoteiro ? undefined : ultimaDescricao,
  });

  let resultado: ResultadoPercepcao | null;
  try {
    resultado = await motor.analisar(
      { imagem: base64, snapshot: dataUrl },
      signal,
      (parcial) => setStatus(`Ollama: ${colapsarRepeticoes(parcial)}`)
    );
  } catch (err) {
    if (ehCancelamento(err) || signal.aborted) return;
    setStatus((err as Error).message);
    return;
  }
  if (signal.aborted || !resultado) return;
  ultimaDuracaoMs = resultado.duracaoMs;

  if (ehRoteiro && resultado.confianca?.semMudanca) {
    setStatus(`Sem mudancas neste intervalo (${resultado.duracaoMs} ms).`);
    return;
  }

  if (ehRoteiro) {
    if (roteiroPrimeiro) roteiroPrimeiro = false;
    roteiroBeats.push(colapsarRepeticoes(resultado.descricao ?? ""));
    if (roteiroBeats.length > 64) roteiroBeats.splice(0, roteiroBeats.length - 64);
  }

  const entry = entradaDeResultado(resultado, ehRoteiro ? "roteiro" : "descricao");
  ultimaDescricao = resultado.descricao ?? "";
  addLogEntry(entry);

  const tokens = resultado.confianca?.tokens;
  if (tokens) {
    const tokS =
      resultado.duracaoMs > 0 ? Math.round(tokens / (resultado.duracaoMs / 1000)) : 0;
    setStatus(
      `Ollama viu: ${resultado.descricao} (${resultado.duracaoMs} ms · ${tokens} toks · ${tokS} tok/s)`
    );
  } else {
    setStatus(`Ollama viu: ${resultado.descricao} (${resultado.duracaoMs} ms)`);
  }
}

async function analisarDeteccao(signal: AbortSignal): Promise<void> {
  const width = camera.largura;
  const height = camera.altura;
  if (!width || !height) return;
  overlay.width = width;
  overlay.height = height;

  const dataUrl = camera.capturarFrame();
  if (dataUrl === null) return;

  setStatus("Analisando frame...");
  let resultado: ResultadoPercepcao | null;
  try {
    if (!motorAtual) return;
    resultado = await motorAtual.analisar({ imagem: dataUrl }, signal);
  } catch (err) {
    if (ehCancelamento(err) || signal.aborted) return;
    setStatus(`Erro na inferencia: ${(err as Error).message}`);
    return;
  }
  if (signal.aborted || !resultado) return;
  ultimaDuracaoMs = resultado.duracaoMs;

  const thumb = camera.capturarFrame(240);
  resultado.snapshot = thumb ?? undefined;

  const timestamp = new Date().toISOString();
  const agora = performance.now();
  const quadro = rastreador.processar(resultado.objetos, agora, {
    timestamp,
    snapshot: resultado.snapshot,
    modelo: resultado.modelo,
  });
  const sinalCena = detectorCena.avaliar(camera.assinaturaDeCena(), agora, {
    timestamp,
    snapshot: resultado.snapshot,
    modelo: resultado.modelo,
  });
  const eventos = sinalCena ? [...quadro.eventos, sinalCena] : quadro.eventos;
  drawBoxes(quadro.objetos);

  const entry = entradaDeResultado(resultado, "deteccao");
  addLogEntry(entry);
  const resumoEventos = eventos.map((e) => e.descricao).join(", ");
  setStatus(
    `Viu: ${entry.resumo}  (${resultado.duracaoMs} ms)${resumoEventos ? ` · ${resumoEventos}` : ""}`
  );

  void api.gravarEntrada(entry).catch(() => {
    if (running) setStatus("Falha ao gravar no log do servidor");
  });
}

async function analisar(): Promise<void> {
  if (!running) return;
  const ctrl = new AbortController();
  controller = ctrl;
  const { signal } = ctrl;
  setSpinner(true);
  try {
    const modo = motorSelect.value;
    if (modo === "ollama" || modo === "roteiro") {
      await analisarComOllama(signal, modo === "roteiro");
      return;
    }
    await analisarDeteccao(signal);
  } finally {
    if (controller === ctrl) {
      controller = null;
      setSpinner(false);
    }
  }
}

async function prepararOllama(motor: MotorPercepcao): Promise<void> {
  setSpinner(true);
  try {
    await motor.inicializar(setStatus);
  } finally {
    setSpinner(false);
  }
}

async function start(): Promise<void> {
  if (running) return;
  startBtn.disabled = true;
  ultimaDescricao = "";
  ultimaDuracaoMs = 0;
  roteiroBeats = [];
  roteiroPrimeiro = true;
  rastreador.reiniciar();
  detectorCena.reiniciar();

  try {
    await camera.iniciar();
  } catch (err) {
    if (err instanceof ErroCamera && err.fase === "video") {
      falharInicializacao(`Falha ao iniciar o video: ${err.message}`);
    } else {
      falharInicializacao(`Nao foi possivel acessar a webcam: ${(err as Error).message}`);
    }
    return;
  }
  placeholder.style.display = "none";

  if (motorSelect.value === "ollama" || motorSelect.value === "roteiro") {
    const motor = new MotorOllama({
      modo: motorSelect.value === "roteiro" ? "roteiro" : "descricao",
    });
    motorAtual = motor;
    try {
      await prepararOllama(motor);
    } catch (err) {
      falharInicializacao(`Falha ao preparar o Ollama: ${(err as Error).message}`);
      return;
    }
  } else {
    const motor = new MotorDeteccao({
      detector: detectorCoco,
      modelo: modelSelect.value,
      obterThreshold: () => Number(thresholdInput.value),
    });
    motorAtual = motor;
    try {
      await motor.inicializar(setStatus);
    } catch (err) {
      falharInicializacao(`Falha ao carregar modelo: ${(err as Error).message}`);
      return;
    }
  }

  if (!camera.ativa) return;
  running = true;
  stopBtn.disabled = false;
  await agendador.iniciar();
}

function encerrarCaptura(): void {
  running = false;
  agendador.parar();
  if (controller) {
    controller.abort();
    controller = null;
  }
  motorAtual?.encerrar();
  motorAtual = null;
  camera.encerrar();
}

function restaurarInterfaceIdle(): void {
  setSpinner(false);
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  placeholder.style.display = "grid";
  startBtn.disabled = false;
  stopBtn.disabled = true;
}

function falharInicializacao(mensagem: string): void {
  encerrarCaptura();
  restaurarInterfaceIdle();
  setStatus(mensagem);
}

function stop(): void {
  encerrarCaptura();
  restaurarInterfaceIdle();
  setStatus("Parado.");
}

async function verificarOllama(): Promise<void> {
  try {
    const o = await api.saudeOllama();
    if (o?.online) {
      const memoria = o.carregados?.length ? ` · em memoria: ${o.carregados.join(", ")}` : "";
      ollamaStatusEl.textContent = `Ollama: online${o.modelos.length ? " (" + o.modelos.join(", ") + ")" : ""}${memoria}`;
      ollamaStatusEl.className = "health online";
      ollamaStatusEl.title = (o.modelos.join("\n") || "Ollama acessivel") + (memoria ? `\n${memoria}` : "");
    } else {
      ollamaStatusEl.textContent = `Ollama: offline${o?.erro ? " — " + o.erro : ""}`;
      ollamaStatusEl.className = "health offline";
    }
  } catch {
    ollamaStatusEl.textContent = "Ollama: servidor indisponivel";
    ollamaStatusEl.className = "health offline";
  }
}

function aplicarFiltro(): void {
  const termo = filterInput.value.trim().toLowerCase();
  for (const item of Array.from(logEl.children)) {
    const texto = (item.textContent ?? "").toLowerCase();
    (item as HTMLElement).hidden = termo.length > 0 && !texto.includes(termo);
  }
}

async function exportarLog(): Promise<void> {
  exportBtn.disabled = true;
  try {
    const entradas = await api.listarEntradas(500);
    const blob = new Blob([JSON.stringify(entradas, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.download = `neuro-vision-log-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("Log exportado.");
  } catch (err) {
    setStatus(`Falha ao exportar: ${(err as Error).message}`);
  } finally {
    atualizarContagem();
  }
}

startBtn.addEventListener("click", () => void start());
stopBtn.addEventListener("click", stop);
clearLogBtn.addEventListener("click", () => void limparHistorico());
exportBtn.addEventListener("click", () => void exportarLog());
filterInput.addEventListener("input", aplicarFiltro);

intervalInput.addEventListener("input", () => {
  intervalValue.textContent = `${intervalInput.value}s`;
  intervaloMsConfigurado = Number(intervalInput.value) * 1000;
  agendador.reajustar();
});

thresholdInput.addEventListener("input", () => {
  thresholdValue.textContent = Number(thresholdInput.value).toFixed(2);
});

motorSelect.addEventListener("change", () => {
  ultimaDescricao = "";
  roteiroBeats = [];
  roteiroPrimeiro = true;
});

atualizarContagem();
void carregarHistorico();
void verificarOllama();