import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";
import type { Detector, Deteccao, ProgressInfo } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";
import type { EntradaLog, ObjetoVisto } from "../src/types";
import { colapsarRepeticoes } from "../src/texto";
import { AgendadorAnalise } from "./scheduler";

env.allowLocalModels = false;
env.useBrowserCache = true;

const COCO_PT: Record<string, string> = {
  person: "pessoa",
  bicycle: "bicicleta",
  car: "carro",
  motorcycle: "moto",
  airplane: "aviao",
  bus: "onibus",
  train: "trem",
  truck: "caminhao",
  boat: "barco",
  "traffic light": "semaforo",
  "fire hydrant": "hidrante",
  "stop sign": "placa de pare",
  "parking meter": "parquimetro",
  bench: "banco",
  cat: "gato",
  dog: "cachorro",
  bird: "passaro",
  horse: "cavalo",
  sheep: "ovelha",
  cow: "vaca",
  elephant: "elefante",
  bear: "urso",
  zebra: "zebra",
  giraffe: "girafa",
  backpack: "mochila",
  umbrella: "guarda-chuva",
  handbag: "bolsa",
  tie: "gravata",
  suitcase: "mala",
  frisbee: "frisbee",
  skis: "esquis",
  snowboard: "snowboard",
  "sports ball": "bola",
  kite: "pipa",
  "baseball bat": "bastao",
  "baseball glove": "luva",
  skateboard: "skate",
  surfboard: "prancha",
  "tennis racket": "raquete",
  bottle: "garrafa",
  "wine glass": "taca",
  cup: "copo",
  fork: "garfo",
  knife: "faca",
  spoon: "colher",
  bowl: "tigela",
  banana: "banana",
  apple: "maca",
  sandwich: "sanduiche",
  orange: "laranja",
  broccoli: "brocolis",
  carrot: "cenoura",
  "hot dog": "cachorro-quente",
  pizza: "pizza",
  donut: "rosquinha",
  cake: "bolo",
  chair: "cadeira",
  couch: "sofa",
  "potted plant": "planta",
  bed: "cama",
  "dining table": "mesa",
  toilet: "vaso sanitario",
  tv: "televisao",
  laptop: "notebook",
  mouse: "mouse",
  remote: "controle",
  keyboard: "teclado",
  "cell phone": "celular",
  microwave: "micro-ondas",
  oven: "forno",
  toaster: "torradeira",
  sink: "pia",
  refrigerator: "geladeira",
  book: "livro",
  clock: "relogio",
  vase: "vaso",
  scissors: "tesoura",
  "teddy bear": "urso de pelucia",
  "hair drier": "secador",
  toothbrush: "escova de dentes",
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

const frameCanvas = document.createElement("canvas");
const frameCtx = frameCanvas.getContext("2d");

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

let detector: Detector | null = null;
let loadedModel: string | null = null;
const detectores = new Map<string, Detector>();
let stream: MediaStream | null = null;
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

function traduzir(label: string): string {
  return COCO_PT[label] ?? label;
}

async function getDetector(modelId: string): Promise<Detector> {
  const cacheado = detectores.get(modelId);
  if (cacheado) {
    detector = cacheado;
    loadedModel = modelId;
    return cacheado;
  }

  const onProgress = (p: ProgressInfo): void => {
    if (p.status === "progress" && p.file) {
      const pct = p.progress ? Math.round(p.progress) : 0;
      setStatus(`Baixando ${p.file}... ${pct}%`);
    }
  };

  setStatus(`Carregando modelo ${modelId}...`);
  const gpu = (navigator as Navigator & { gpu?: unknown }).gpu;
  const device = gpu ? "webgpu" : "wasm";
  let novo: Detector;
  try {
    novo = await pipeline("object-detection", modelId, { device, progress_callback: onProgress });
  } catch (err) {
    setStatus(`WebGPU indisponivel, usando CPU: ${(err as Error).message}`);
    novo = await pipeline("object-detection", modelId, { device: "wasm", progress_callback: onProgress });
  }
  detectores.set(modelId, novo);
  detector = novo;
  loadedModel = modelId;
  return novo;
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

function capturarFrame(maxWidth = 0): string | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || !frameCtx) return null;

  const escala = maxWidth > 0 && vw > maxWidth ? maxWidth / vw : 1;
  const w = Math.round(vw * escala);
  const h = Math.round(vh * escala);
  frameCanvas.width = w;
  frameCanvas.height = h;
  frameCtx.drawImage(video, 0, 0, w, h);
  return frameCanvas.toDataURL("image/jpeg", 0.85);
}

async function descreverViaOllama(signal: AbortSignal): Promise<void> {
  const dataUrl = capturarFrame(512);
  if (dataUrl === null) return;
  const width = video.videoWidth;
  const height = video.videoHeight;
  overlay.width = width;
  overlay.height = height;
  ctx.clearRect(0, 0, width, height);

  const base64 = dataUrl.split(",")[1] ?? "";
  setStatus("Ollama analisando frame... (pode demorar)");
  const started = performance.now();

  const ehRoteiro = motorSelect.value === "roteiro";
  const roteiro = ehRoteiro ? roteiroBeats.slice(-8).join(" ").slice(0, 1200) : "";
  const corpo: Record<string, unknown> = { imagem: base64, snapshot: dataUrl };
  if (ehRoteiro) {
    corpo.modo = "roteiro";
    corpo.roteiro = roteiro;
    corpo.base = roteiroPrimeiro;
  } else {
    corpo.anterior = ultimaDescricao;
  }

  let resposta: Response;
  try {
    resposta = await fetch("/api/visao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    setStatus("Falha ao contactar o servidor (/api/visao)");
    return;
  }

  if (signal.aborted) return;

  if (!resposta.ok || !resposta.body) {
    const corpo = (await resposta.json().catch(() => null)) as { erro?: string } | null;
    setStatus(corpo?.erro ?? `Ollama respondeu ${resposta.status}`);
    return;
  }

  const reader = resposta.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let parcial = "";
  let resultado: {
    descricao?: string;
    modelo?: string;
    snapshot?: string;
    tokens?: number;
    ms?: number;
    tipo?: string;
    papel?: "base" | "delta";
    semMudanca?: boolean;
  } | null = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const linha = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!linha) continue;
        const evt = JSON.parse(linha) as {
          type?: string;
          response?: string;
          descricao?: string;
          modelo?: string;
          snapshot?: string;
          erro?: string;
          tokens?: number;
          ms?: number;
          tipo?: string;
          papel?: "base" | "delta";
          semMudanca?: boolean;
        };
        if (evt.type === "chunk" && evt.response) {
          parcial += evt.response;
          setStatus(`Ollama: ${colapsarRepeticoes(parcial)}`);
        } else if (evt.type === "done") {
          resultado = evt;
        } else if (evt.type === "erro") {
          setStatus(evt.erro ?? "Erro no Ollama");
          return;
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    setStatus(`Erro ao ler resposta do Ollama: ${(err as Error).message}`);
    return;
  }

  if (signal.aborted) return;

  const descricao = resultado?.descricao ?? parcial;
  const ms = Math.round(performance.now() - started);
  ultimaDuracaoMs = ms;

  if (ehRoteiro && resultado?.semMudanca) {
    setStatus(`Sem mudancas neste intervalo (${ms} ms).`);
    return;
  }

  if (ehRoteiro) {
    if (roteiroPrimeiro) roteiroPrimeiro = false;
    roteiroBeats.push(colapsarRepeticoes(descricao));
    if (roteiroBeats.length > 64) roteiroBeats.splice(0, roteiroBeats.length - 64);
  }

  const entradaTipo: EntradaLog["tipo"] = ehRoteiro ? "roteiro" : "descricao";
  const entry: EntradaLog = {
    timestamp: new Date().toISOString(),
    modelo: resultado?.modelo ?? "ollama",
    objetos: [],
    resumo: descricao,
    tipo: entradaTipo,
    papel: ehRoteiro ? (resultado?.papel ?? "delta") : undefined,
    snapshot: resultado?.snapshot,
    ms,
    tokens: resultado?.tokens,
  };
  ultimaDescricao = descricao;
  addLogEntry(entry);
  if (resultado?.tokens) {
    const tokS = Math.round(resultado.tokens / (ms / 1000));
    setStatus(`Ollama viu: ${descricao} (${ms} ms · ${resultado.tokens} toks · ${tokS} tok/s)`);
  } else {
    setStatus(`Ollama viu: ${descricao} (${ms} ms)`);
  }
}

async function analisar(): Promise<void> {
  if (!running) return;
  const ctrl = new AbortController();
  controller = ctrl;
  const { signal } = ctrl;
  setSpinner(true);
  try {
    if (motorSelect.value === "ollama" || motorSelect.value === "roteiro") {
      await descreverViaOllama(signal);
      return;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return;

    overlay.width = width;
    overlay.height = height;

    const dataUrl = capturarFrame();
    if (dataUrl === null) return;

    const threshold = Number(thresholdInput.value);
    setStatus("Analisando frame...");
    const started = performance.now();
    let detecoes: Deteccao[];
    try {
      detecoes = await detector!(dataUrl, { threshold, percentage: false });
    } catch (err) {
      if (signal.aborted) return;
      setStatus(`Erro na inferencia: ${(err as Error).message}`);
      return;
    }
    if (signal.aborted) return;
    const ms = Math.round(performance.now() - started);
    ultimaDuracaoMs = ms;

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

    const thumb = capturarFrame(240);
    const entry: EntradaLog = {
      timestamp: new Date().toISOString(),
      modelo: loadedModel ?? "desconhecido",
      objetos,
      resumo,
      tipo: "deteccao",
      snapshot: thumb ?? undefined,
      ms,
    };

    addLogEntry(entry);
    setStatus(`Viu: ${resumo}  (${ms} ms)`);

    fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    }).catch(() => {
      if (running) setStatus("Falha ao gravar no log do servidor");
    });
  } finally {
    if (controller === ctrl) {
      controller = null;
      setSpinner(false);
    }
  }
}

async function prepararOllama(): Promise<void> {
  setSpinner(true);
  setStatus("Carregando modelo do Ollama na memoria (pode demorar)...");
  try {
    const resposta = await fetch("/api/visao/preparar");
    if (!resposta.ok) {
      const corpo = (await resposta.json().catch(() => null)) as { erro?: string } | null;
      throw new Error(corpo?.erro ?? `Falha ao preparar Ollama (${resposta.status})`);
    }
    const dados = (await resposta.json()) as { modelo?: string; carregado?: boolean; carregandoMs?: number };
    if (dados.carregado !== true) {
      throw new Error("modelo nao confirmado em memoria; verifique o Ollama.");
    }
    const seg = Math.round((dados.carregandoMs ?? 0) / 1000);
    setStatus(
      `Modelo ${dados.modelo ?? ""} carregado${seg > 0 ? ` em ${seg}s` : " (ja estava em memoria)"}. Pronto!`
    );
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

  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
  } catch (err) {
    falharInicializacao(`Nao foi possivel acessar a webcam: ${(err as Error).message}`);
    return;
  }

  video.srcObject = stream;
  try {
    await video.play();
  } catch (err) {
    falharInicializacao(`Falha ao iniciar o video: ${(err as Error).message}`);
    return;
  }
  placeholder.style.display = "none";

  if (motorSelect.value === "ollama" || motorSelect.value === "roteiro") {
    try {
      await prepararOllama();
    } catch (err) {
      falharInicializacao(`Falha ao preparar o Ollama: ${(err as Error).message}`);
      return;
    }
  } else {
    try {
      await getDetector(modelSelect.value);
    } catch (err) {
      falharInicializacao(`Falha ao carregar modelo: ${(err as Error).message}`);
      return;
    }
  }

  if (!stream) return;
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
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  video.srcObject = null;
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
    const resposta = await fetch("/api/health");
    const dados = (await resposta.json()) as {
      ollama?: {
        online: boolean;
        modelos: string[];
        carregados: string[];
        erro: string;
      };
    };
    const o = dados.ollama;
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
    const resposta = await fetch("/api/logs?limit=500");
    const dados = (await resposta.json()) as { entradas?: EntradaLog[] };
    const blob = new Blob([JSON.stringify(dados.entradas ?? [], null, 2)], {
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