import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";
import type { Detector, Deteccao, ProgressInfo } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";
import type { EntradaLog, ObjetoVisto } from "../src/types";

env.allowLocalModels = false;
env.useBrowserCache = true;

const COCO_PT: Record<string, string> = {
  person: "pessoa",
  bicycle: "bicicleta",
  car: "carro",
  motorcycle: "moto",
  bus: "onibus",
  truck: "caminhao",
  cat: "gato",
  dog: "cachorro",
  bird: "passaro",
  "cell phone": "celular",
  laptop: "notebook",
  tv: "televisao",
  bottle: "garrafa",
  cup: "copo",
  chair: "cadeira",
  "dining table": "mesa",
  book: "livro",
  keyboard: "teclado",
  mouse: "mouse",
  clock: "relogio",
  "potted plant": "planta",
  "teddy bear": "urso de pelucia",
};

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

const placeholder = el<HTMLDivElement>("placeholder");
const statusEl = el<HTMLDivElement>("status");
const logEl = el<HTMLUListElement>("log");
const logCountEl = el<HTMLSpanElement>("logCount");
const clearLogBtn = el<HTMLButtonElement>("clearLog");
const startBtn = el<HTMLButtonElement>("start");
const stopBtn = el<HTMLButtonElement>("stop");
const modelSelect = el<HTMLSelectElement>("model");
const motorSelect = el<HTMLSelectElement>("motor");
const intervalInput = el<HTMLInputElement>("interval");
const intervalValue = el<HTMLSpanElement>("intervalValue");
const thresholdInput = el<HTMLInputElement>("threshold");
const thresholdValue = el<HTMLSpanElement>("thresholdValue");

let detector: Detector | null = null;
let loadedModel: string | null = null;
let stream: MediaStream | null = null;
let running = false;
let timer: ReturnType<typeof setInterval> | null = null;
let ultimaDescricao = "";

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function traduzir(label: string): string {
  return COCO_PT[label] ?? label;
}

async function getDetector(modelId: string): Promise<Detector> {
  if (detector && loadedModel === modelId) return detector;

  const onProgress = (p: ProgressInfo): void => {
    if (p.status === "progress" && p.file) {
      const pct = p.progress ? Math.round(p.progress) : 0;
      setStatus(`Baixando ${p.file}... ${pct}%`);
    }
  };

  setStatus(`Carregando modelo ${modelId}...`);
  const device = "gpu" in navigator ? "webgpu" : "wasm";
  try {
    detector = await pipeline("object-detection", modelId, { device, progress_callback: onProgress });
  } catch (err) {
    setStatus(`WebGPU indisponivel, usando CPU: ${(err as Error).message}`);
    detector = await pipeline("object-detection", modelId, { device: "wasm", progress_callback: onProgress });
  }
  loadedModel = modelId;
  return detector;
}

function drawBoxes(detecoes: Deteccao[]): void {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.lineWidth = 3;
  ctx.font = "16px 'Segoe UI', sans-serif";
  ctx.textBaseline = "top";

  for (const d of detecoes) {
    const { xmin, ymin, xmax, ymax } = d.box;
    ctx.strokeStyle = "#4f9cf9";
    ctx.strokeRect(xmin, ymin, xmax - xmin, ymax - ymin);

    const label = `${traduzir(d.label)} ${(d.score * 100).toFixed(0)}%`;
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = "#4f9cf9";
    ctx.fillRect(xmin, ymin, textWidth + 12, 22);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, xmin + 6, ymin + 3);
  }
}

function atualizarContagem(): void {
  logCountEl.textContent = String(logEl.children.length);
  clearLogBtn.disabled = logEl.children.length === 0;
}

function criarItem(entry: EntradaLog): HTMLLIElement {
  const li = document.createElement("li");

  const cabecalho = document.createElement("div");
  cabecalho.className = "cabecalho";
  const time = document.createElement("span");
  time.className = "time";
  time.textContent = new Date(entry.timestamp).toLocaleTimeString("pt-BR");
  cabecalho.appendChild(time);
  if (entry.modelo) {
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = entry.modelo;
    cabecalho.appendChild(meta);
  }
  li.appendChild(cabecalho);

  const objs = document.createElement("div");
  objs.className = "objs";
  if (entry.tipo === "descricao") {
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
  li.appendChild(objs);
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
    const resposta = await fetch("/api/logs?limit=100");
    if (!resposta.ok) return;
    const dados = (await resposta.json()) as { entradas?: EntradaLog[] };
    const entradas = dados.entradas ?? [];
    logEl.replaceChildren(...entradas.map(criarItem));
    atualizarContagem();
  } catch {
    // historico indisponivel; segue vazio
  }
}

async function limparHistorico(): Promise<void> {
  clearLogBtn.disabled = true;
  try {
    const resposta = await fetch("/api/logs", { method: "DELETE" });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    limparLista();
    atualizarContagem();
    setStatus("Historico limpo.");
  } catch (err) {
    setStatus(`Falha ao limpar historico: ${(err as Error).message}`);
    atualizarContagem();
  }
}

async function capturarFrame(): Promise<string | null> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;

  const frame = document.createElement("canvas");
  frame.width = width;
  frame.height = height;
  const frameCtx = frame.getContext("2d");
  if (!frameCtx) return null;
  frameCtx.drawImage(video, 0, 0, width, height);
  return frame.toDataURL("image/jpeg", 0.85);
}

async function descreverViaOllama(): Promise<void> {
  const dataUrl = await capturarFrame();
  if (dataUrl === null) return;
  const width = video.videoWidth;
  const height = video.videoHeight;
  overlay.width = width;
  overlay.height = height;
  ctx.clearRect(0, 0, width, height);

  const base64 = dataUrl.split(",")[1] ?? "";
  setStatus("Ollama analisando frame...");
  const started = performance.now();

  let resposta: Response;
  try {
    resposta = await fetch("/api/visao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imagem: base64, anterior: ultimaDescricao }),
    });
  } catch {
    setStatus("Falha ao contactar o servidor (/api/visao)");
    return;
  }

  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => null)) as { erro?: string } | null;
    setStatus(corpo?.erro ?? `Ollama respondeu ${resposta.status}`);
    return;
  }

  const dados = (await resposta.json()) as { descricao?: string; modelo?: string };
  const ms = Math.round(performance.now() - started);
  const descricao = dados.descricao ?? "sem descricao";

  const entry: EntradaLog = {
    timestamp: new Date().toISOString(),
    modelo: dados.modelo ?? "ollama",
    objetos: [],
    resumo: descricao,
    tipo: "descricao",
  };
  ultimaDescricao = descricao;
  addLogEntry(entry);
  setStatus(`Ollama viu: ${descricao} (${ms} ms)`);
}

async function analisar(): Promise<void> {
  if (!running) return;
  if (motorSelect.value === "ollama") {
    await descreverViaOllama();
    return;
  }

  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return;

  overlay.width = width;
  overlay.height = height;

  const dataUrl = await capturarFrame();
  if (dataUrl === null) return;

  const threshold = Number(thresholdInput.value);
  setStatus("Analisando frame...");
  const started = performance.now();
  let detecoes: Deteccao[];
  try {
    detecoes = await detector!(dataUrl, { threshold, percentage: false });
  } catch (err) {
    setStatus(`Erro na inferencia: ${(err as Error).message}`);
    return;
  }
  const ms = Math.round(performance.now() - started);

  const objetos: ObjetoVisto[] = detecoes.map((d) => ({
    nome: traduzir(d.label),
    rotulo: d.label,
    score: Number(d.score.toFixed(3)),
    caixa: d.box,
  }));

  drawBoxes(detecoes);

  const contagem: Record<string, number> = {};
  for (const o of objetos) contagem[o.nome] = (contagem[o.nome] ?? 0) + 1;
  const resumo = objetos.length
    ? Object.entries(contagem).map(([n, c]) => (c > 1 ? `${c}x ${n}` : n)).join(", ")
    : "nada reconhecido";

  const entry: EntradaLog = {
    timestamp: new Date().toISOString(),
    modelo: loadedModel ?? "desconhecido",
    objetos,
    resumo,
    tipo: "deteccao",
  };

  addLogEntry(entry);
  setStatus(`Viu: ${resumo}  (${ms} ms)`);

  fetch("/api/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  }).catch(() => setStatus("Falha ao gravar no log do servidor"));
}

function agendarAnalise(intervalMs: number): void {
  if (timer) clearInterval(timer);
  timer = setInterval(() => void analisar(), intervalMs);
}

async function start(): Promise<void> {
  if (running) return;
  startBtn.disabled = true;
  ultimaDescricao = "";
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
  } catch (err) {
    setStatus(`Nao foi possivel acessar a webcam: ${(err as Error).message}`);
    startBtn.disabled = false;
    return;
  }
  video.srcObject = stream;
  await video.play();
  placeholder.style.display = "none";

  if (motorSelect.value === "deteccao") {
    try {
      await getDetector(modelSelect.value);
    } catch (err) {
      setStatus(`Falha ao carregar modelo: ${(err as Error).message}`);
      startBtn.disabled = false;
      return;
    }
  }

  running = true;
  stopBtn.disabled = false;
  agendarAnalise(Number(intervalInput.value) * 1000);
  await analisar();
}

function stop(): void {
  running = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  placeholder.style.display = "grid";
  startBtn.disabled = false;
  stopBtn.disabled = true;
  setStatus("Parado.");
}

startBtn.addEventListener("click", () => void start());
stopBtn.addEventListener("click", stop);
clearLogBtn.addEventListener("click", () => void limparHistorico());

intervalInput.addEventListener("input", () => {
  intervalValue.textContent = `${intervalInput.value}s`;
  if (running) agendarAnalise(Number(intervalInput.value) * 1000);
});

thresholdInput.addEventListener("input", () => {
  thresholdValue.textContent = Number(thresholdInput.value).toFixed(2);
});

motorSelect.addEventListener("change", () => {
  ultimaDescricao = "";
});

atualizarContagem();
void carregarHistorico();