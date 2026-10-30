import type { Caixa, EntradaLog, MarcacaoNsfwLog } from "../src/types";
import { AdaptadorDetectorObjetos } from "./perception/adapters/object-detector.adapter";
import { AdaptadorClassificadorNsfw } from "./perception/adapters/nsfw-classifier.adapter";
import { criarMotorNsfwRemoto } from "./perception/workers/motores-remotos";
import { Camera } from "./camera";
import { obterModo } from "./modos";
import { MotorVisao } from "./motores";
import { FilaPersistencia } from "./persistencia";
import { rotuloMotivo } from "../src/politica-analise";
import * as api from "./api";
import { CycleController } from "./cycle/cycle-controller";
import type { ControladorCiclo, EventoUi, ItemHistorico } from "./cycle/cycle-controller";
import { CicloPercepcaoController } from "./cycle/ciclo-percepcao-controller";
import { criarPercepcaoLocal } from "./perception/percepcao-local";
import { obterVariante } from "./perception/variantes";
import type { VariantePercepcao } from "./perception/variantes";
import type { HabilitacaoSubsistemas } from "./perception/local-perception-pipeline";
import { MODELO_NSFW_PADRAO } from "./nsfw-onnx";
import { MotorTemporalImpl } from "./temporal/motor-temporal";
import { InterpretadorCiclo } from "./interpretation/interpretador-ciclo";
import { criarTransporteServidor } from "./interpretation/transporte-servidor";
import { POLITICA_CICLO_OPERACIONAL } from "./cycle/politica-ciclo";
import type { PoliticaCiclo } from "./cycle/politica-ciclo";
import { CONFIG_CAPTURA_PADRAO } from "./capture/webcam-capture";
import type { ConfigCaptura } from "./capture/webcam-capture";

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
const modeloStatusEl = el<HTMLSpanElement>("modeloStatus");
const diagInfoEl = el<HTMLSpanElement>("diagInfo");
const persistAvisoEl = el<HTMLSpanElement>("persistAviso");
const logEl = el<HTMLUListElement>("log");
const logCountEl = el<HTMLSpanElement>("logCount");
const clearLogBtn = el<HTMLButtonElement>("clearLog");
const exportBtn = el<HTMLButtonElement>("exportLog");
const exportPendentesBtn = el<HTMLButtonElement>("exportPendentes");
const filterInput = el<HTMLInputElement>("filter");
const startBtn = el<HTMLButtonElement>("start");
const stopBtn = el<HTMLButtonElement>("stop");
const analisarAgoraBtn = el<HTMLButtonElement>("analisarAgora");
const modelSelect = el<HTMLSelectElement>("model");
const modeloVisaoSelect = el<HTMLSelectElement>("modeloVisao");
const motorSelect = el<HTMLSelectElement>("motor");
const intervalInput = el<HTMLInputElement>("interval");
const intervalValue = el<HTMLSpanElement>("intervalValue");
const thresholdInput = el<HTMLInputElement>("threshold");
const thresholdValue = el<HTMLSpanElement>("thresholdValue");
const nsfwToggle = el<HTMLInputElement>("nsfw");

/**
 * Politica do ciclo (Fase 4): fonte unica de espacamento/quantidade de
 * snapshots, pausa pos-ciclo e frequencia da interpretacao. O intervalo entre
 * inicios continua vindo do seletor da interface (`intervaloMsConfigurado`); a
 * pausa pos-ciclo e contada do **fim** de cada ciclo.
 */
const politicaCiclo: PoliticaCiclo = POLITICA_CICLO_OPERACIONAL;

/** Captura derivada da politica: quantidade e espacamento dos snapshots. */
const configuracaoCaptura: ConfigCaptura = {
  ...CONFIG_CAPTURA_PADRAO,
  quadros: politicaCiclo.quantidadeSnapshots,
  intervaloMs: politicaCiclo.intervaloEntreSnapshotsMs,
};

const detectorCoco = new AdaptadorDetectorObjetos();
/**
 * Classificador NSFW do modo de frame unico (worker dedicado, fallback local).
 * O multiframe cria o proprio adaptador dentro do pipeline local; este atende
 * `deteccao`, `eventos`, `visao` e `roteiro` quando o toggle esta ligado.
 */
const classificadorNsfw = new AdaptadorClassificadorNsfw(criarMotorNsfwRemoto());
let running = false;
let intervaloMsConfigurado = Number(intervalInput.value) * 1000;

/** Fila de persistencia: serializa gravacoes, retenta falhas transitorias e alimenta o diagnostico. */
const filaPersistencia = new FilaPersistencia({
  aoMudar: () => atualizarDiagnostico(),
});

/** Ultimo status do backend de visao conhecido (motor/modelos/carregados), para o diagnostico. */
let infoVisao: api.InfoVisao | null = null;

/** Renderizacao do progresso emitido pelo `CycleController` (sem logica de negocio aqui). */
function aoUi(evento: EventoUi): ItemHistorico | void {
  switch (evento.tipo) {
    case "status":
      setStatus(evento.texto);
      return;
    case "spinner":
      setSpinner(evento.ativo);
      return;
    case "exibir_entrada": {
      const item = addLogEntry(evento.entrada);
      return {
        marcarNaoGravado: () => {
          item.classList.add("nao-gravado");
          item.title = "Nao gravado no servidor (falha de persistencia).";
        },
      };
    }
    case "desenhar_caixas":
      drawBoxes(evento.objetos, evento.nsfw);
      return;
    case "preparar_canvas":
      overlay.width = evento.largura;
      overlay.height = evento.altura;
      return;
    case "limpar_canvas":
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      return;
    case "iniciando":
      startBtn.disabled = true;
      habilitarSeletoresDeMotor(false);
      return;
    case "camera_iniciada":
      placeholder.style.display = "none";
      return;
    case "pronto":
      running = true;
      stopBtn.disabled = false;
      atualizarBotoesAnalise();
      atualizarDiagnostico();
      // O modelo de visao pode ter subido junto com a inicializacao.
      void verificarVisao();
      return;
    case "falha_inicializacao":
      running = false;
      restaurarInterfaceIdle();
      atualizarDiagnostico();
      setStatus(evento.mensagem);
      return;
    case "parado":
      running = false;
      restaurarInterfaceIdle();
      atualizarDiagnostico();
      setStatus("Parado.");
      return;
  }
}

/**
 * Controlador do ciclo de frame unico: dono da logica de captura/inferencia/
 * temporal/persistencia. Todas as dependencias sao injetadas aqui, no ponto de
 * composicao — o controlador nao cria nada escondido.
 */
const controladorFrame = new CycleController({
  camera,
  aoUi,
  repositorio: {
    gravarEntrada: api.gravarEntrada,
    gravarEvento: api.gravarEvento,
    gravarOperacional: api.gravarOperacional,
  },
  fila: filaPersistencia,
  obterModo: () => obterModo(motorSelect.value),
  criarMotor: () => {
    const definicao = obterModo(motorSelect.value);
    if (!definicao.criarMotor) {
      throw new Error(`O modo ${definicao.id} nao usa motor de frame unico.`);
    }
    return definicao.criarMotor({
      detector: detectorCoco,
      modelo: modelSelect.value,
      modeloVisao: modeloVisaoSelecionado(),
      obterThreshold: () => Number(thresholdInput.value),
    });
  },
  criarMotorVisao: (opcoes) => new MotorVisao(opcoes),
  obterModeloVisao: () => modeloVisaoSelecionado(),
  obterIntervaloMs: () => intervaloMsConfigurado,
  classificadorNsfw,
  // So carrega quando o toggle esta ligado no inicio da sessao; desligado, o
  // modo de frame unico roda exatamente como antes.
  obterModeloNsfw: () => (nsfwToggle.checked ? MODELO_NSFW_PADRAO : undefined),
});

/**
 * Controlador do ciclo multiframe: pipeline local completo (deteccao + pose +
 * maos), motor temporal e interpretacao multimodal.
 *
 * O `detectorCoco` da thread principal atende apenas os modos de frame unico.
 * O multiframe usa o detector em **worker dedicado** (ver
 * `perception/workers/`), para nao disputar a main thread com captura,
 * renderizacao e interpretacao; o mesmo id de modelo selecionado e carregado
 * dentro do worker.
 */
const controladorPercepcao = new CicloPercepcaoController({
  camera,
  aoUi,
  repositorio: {
    gravarCiclo: api.gravarCiclo,
    gravarEntrada: api.gravarEntrada,
    gravarEvento: api.gravarEvento,
    gravarOperacional: api.gravarOperacional,
  },
  fila: filaPersistencia,
  obterModo: () => obterModo(motorSelect.value),
  criarPercepcao: () =>
    criarPercepcaoLocal({
      habilitacao: montarHabilitacao(),
      obterThreshold: () => Number(thresholdInput.value),
      aoStatus: (mensagem) => setStatus(mensagem),
    }),
  obterModelosPercepcao: () => ({
    objetos: modelSelect.value,
    // NSFW experimental: so carrega quando o toggle esta ligado no inicio da
    // sessao (o toggle fica bloqueado durante a captura, como os seletores).
    nsfw: nsfwToggle.checked ? MODELO_NSFW_PADRAO : undefined,
  }),
  criarMotorTemporal: (modo) => new MotorTemporalImpl({ modo }),
  criarInterpretador: () =>
    new InterpretadorCiclo({
      enviar: criarTransporteServidor(),
      // Getter dinamico: segue a selecao atual da interface, mesmo que ela
      // mude (ou seja preenchida) depois do inicio da sessao. Sem escolha
      // explicita, registra o modelo efetivo do backend (o que o /api/health
      // reporta) — nunca o fallback "multiframe", para a verificacao de mesmo
      // modelo da Etapa 9 valer em qualquer execucao.
      modelo: () => modeloVisaoSelecionado() ?? infoVisao?.modelo ?? undefined,
      incluirDadosLocais: varianteDoModoAtual().dadosLocais,
    }),
  obterIntervaloMs: () => intervaloMsConfigurado,
  politicaCiclo,
  configuracaoCaptura,
});

/** Variante do benchmark declarada pelo modo ativo (B/C/D); padrao: alvo (D). */
function varianteDoModoAtual(): VariantePercepcao {
  return obterVariante(obterModo(motorSelect.value).variante);
}

/**
 * Habilitacao explicita dos subsistemas de percepcao local (Fase 2, item 1).
 *
 * A variante B (Sequência) nao roda percepcao local; as demais ligam
 * deteccao/pose/maos. O NSFW experimental segue o toggle da interface (ligado
 * apenas quando marcado no inicio da sessao).
 */
function montarHabilitacao(): HabilitacaoSubsistemas {
  const variante = varianteDoModoAtual();
  if (!variante.percepcaoLocal) {
    return { deteccao: false, pose: false, maos: false, nsfw: false };
  }
  return {
    deteccao: true,
    pose: true,
    maos: true,
    nsfw: nsfwToggle.checked,
  };
}

/** Controlador do modo ativo: o multiframe tem um fluxo proprio, sem `MotorPercepcao`. */
function controlador(): ControladorCiclo {
  return obterModo(motorSelect.value).multiframe ? controladorPercepcao : controladorFrame;
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function setSpinner(ativo: boolean): void {
  spinnerEl.hidden = !ativo;
}

/** Modelo de deteccao em uso no navegador, ou "—" quando o motor nao precisa dele. */
function modeloDeDeteccaoAtivo(): string | null {
  return obterModo(motorSelect.value).usaDeteccao ? modelSelect.value : null;
}

/** Chave do modelo de visao escolhido na interface (persistido no navegador). */
const MODELO_VISAO_STORAGE = "neuro.modeloVisao";

/** Modelo de visao escolhido na interface; `undefined` = padrao do servidor. */
function modeloVisaoSelecionado(): string | undefined {
  return modeloVisaoSelect.value.trim() || undefined;
}

function carregarModeloVisaoSalvo(): void {
  try {
    const salvo = localStorage.getItem(MODELO_VISAO_STORAGE);
    if (salvo) modeloVisaoSelect.value = salvo;
  } catch {
    // localStorage indisponivel (modo privado): segue com o padrao do servidor.
  }
}

function salvarModeloVisao(): void {
  try {
    const valor = modeloVisaoSelect.value;
    if (valor) localStorage.setItem(MODELO_VISAO_STORAGE, valor);
    else localStorage.removeItem(MODELO_VISAO_STORAGE);
  } catch {
    // Best-effort: a escolha vale para a sessao mesmo sem persistir.
  }
}

/**
 * Preenche o seletor de modelo de visao com os modelos instalados no backend
 * (`GET /api/health`) e preserva a escolha atual, mesmo que ela nao esteja na
 * lista (backend offline ou modelo desinstalado).
 */
function atualizarOpcoesModeloVisao(): void {
  const atual = modeloVisaoSelect.value.trim();
  // Modelos de embedding nunca respondem a visao: filtra por nome.
  const instalados = (infoVisao?.modelos ?? []).filter((id) => !/embed/i.test(id));
  const ids = ["", ...instalados];
  if (atual && !instalados.includes(atual)) ids.splice(1, 0, atual);

  modeloVisaoSelect.replaceChildren(
    ...ids.map((id) => {
      const opcao = document.createElement("option");
      opcao.value = id;
      opcao.textContent = id || "Padrão do servidor";
      return opcao;
    })
  );
  modeloVisaoSelect.value = atual;
  modeloVisaoSelect.title = instalados.length
    ? `Instalados no backend:\n${instalados.join("\n")}`
    : "Backend offline ou sem modelos instalados.";
}

/**
 * Linha de diagnostico: motor ativo, modelo solicitado, modelo carregado no
 * backend e separacao entre carga, inferencia e persistencia.
 */
function atualizarDiagnostico(): void {
  const motor = running ? motorSelect.value : "parado";
  const definicao = obterModo(motorSelect.value);
  const deteccao = modeloDeDeteccaoAtivo();
  const modeloVisao = modeloVisaoSelecionado() ?? infoVisao?.modelo ?? "?";
  const modelo =
    definicao.usaDeteccao && definicao.usaVisao
      ? `${deteccao} + ${modeloVisao}`
      : deteccao ?? modeloVisao;
  const carregados = !infoVisao
    ? "?"
    : infoVisao.online === false
      ? "offline"
      : infoVisao.carregados?.length
        ? infoVisao.carregados.join(", ")
        : "nenhum";

  const partes = [`motor ${motor}`, `backend LM Studio`, `modelo ${modelo}`, `carregados: ${carregados}`];
  if (definicao.usaDeteccao && detectorCoco.dispositivo) {
    partes.push(`dispositivo ${detectorCoco.dispositivo}`);
  }
  if (infoVisao?.solicitado && infoVisao.solicitado !== infoVisao.modelo) {
    partes.push(`fallback de ${infoVisao.solicitado}`);
  }
  if (controlador().ultimaCargaMs > 0) partes.push(`carga ${(controlador().ultimaCargaMs / 1000).toFixed(1)}s`);
  if (controlador().ultimaDuracaoMs > 0) partes.push(`inferencia ${controlador().ultimaDuracaoMs} ms`);
  if (controlador().ultimaPersistenciaMs > 0) partes.push(`persistencia ${controlador().ultimaPersistenciaMs} ms`);

  const fila = filaPersistencia.estado;
  if (fila.pendentes > 0) partes.push(`fila ${fila.pendentes}`);
  if (fila.falhas > 0) partes.push(`falhas de persistencia ${fila.falhas}`);

  diagInfoEl.textContent = `Diagnostico: ${partes.join(" · ")}`;
  diagInfoEl.title = partes.join("\n");

  // Uma falha de gravacao fica visivel e nao pode ser confundida com um
  // evento salvo. O aviso so some quando nao ha mais gravacoes falhando.
  if (fila.falhas > 0) {
    const detalhe = fila.ultimoErro ? ` — ${fila.ultimoErro}` : "";
    persistAvisoEl.textContent = `Aviso: ${fila.falhas} gravacao(oes) nao chegaram ao servidor${detalhe}. Use "Pendentes" para exportar.`;
    persistAvisoEl.hidden = false;
  } else {
    persistAvisoEl.textContent = "";
    persistAvisoEl.hidden = true;
  }
  exportPendentesBtn.disabled = fila.falhas === 0;
}

/** "Analisar agora" so faz sentido no modo eventos, com a sessao rodando. */
function atualizarBotoesAnalise(): void {
  analisarAgoraBtn.disabled = !running || !obterModo(motorSelect.value).permiteAnaliseManual;
}

/**
 * Trocar o motor ou o modelo exige reinicializar o motor ativo. Para nao rodar
 * com uma combinacao incoerente, os seletores ficam bloqueados enquanto a
 * captura esta ativa e so voltam a ficar disponiveis ao parar.
 */
function habilitarSeletoresDeMotor(habilitado: boolean): void {
  motorSelect.disabled = !habilitado;
  modelSelect.disabled = !habilitado;
  modeloVisaoSelect.disabled = !habilitado;
  // O NSFW e carregado na configuracao da sessao: trocar no meio da captura
  // nao teria efeito, entao o toggle tambem bloqueia junto dos seletores.
  nsfwToggle.disabled = !habilitado;
}

function drawBoxes(
  objetos: ReadonlyArray<{ nome: string; score: number; caixa: Caixa }>,
  nsfw: ReadonlyArray<MarcacaoNsfwLog> = []
): void {
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

  // NSFW: caixas normalizadas [0,1] relativas ao frame; cor distinta para nao
  // se confundirem com as deteccoes COCO (pixels).
  for (const m of nsfw) {
    const { xmin, ymin, xmax, ymax } = m.caixa;
    const x = xmin * overlay.width;
    const y = ymin * overlay.height;
    const w = (xmax - xmin) * overlay.width;
    const h = (ymax - ymin) * overlay.height;
    ctx.strokeStyle = "#ff4d6d";
    ctx.strokeRect(x, y, w, h);

    const label = `NSFW ${m.rotulo} ${(m.score * 100).toFixed(0)}%`;
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = "#ff4d6d";
    ctx.fillRect(x, y, textWidth + 12, 22);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, x + 6, y + 3);
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
    if (entry.capturadoEm) {
      img.title = `Frame capturado às ${new Date(entry.capturadoEm).toLocaleTimeString("pt-BR")}`;
    }
    li.appendChild(img);
  }

  const corpo = document.createElement("div");
  corpo.className = "corpo";

  const cabecalho = document.createElement("div");
  cabecalho.className = "cabecalho";
  const time = document.createElement("span");
  time.className = "time";
  // O horario exibido e o da CAPTURA do frame; `timestamp` e o fim da analise.
  const capturadoEm = entry.capturadoEm ? new Date(entry.capturadoEm) : null;
  const analisadoEm = new Date(entry.timestamp);
  time.textContent = (capturadoEm ?? analisadoEm).toLocaleTimeString("pt-BR");
  if (capturadoEm) {
    const atrasoS = (analisadoEm.getTime() - capturadoEm.getTime()) / 1000;
    time.title =
      atrasoS >= 1
        ? `Frame capturado às ${capturadoEm.toLocaleTimeString("pt-BR")} · analisado ${atrasoS.toFixed(1)}s depois`
        : `Frame capturado às ${capturadoEm.toLocaleTimeString("pt-BR")}`;
  }
  cabecalho.appendChild(time);
  if (entry.modelo) {
    const meta = document.createElement("span");
    meta.className = "meta";
    let texto = entry.modelo;
    if (entry.ms && entry.tokens) {
      const tokS = Math.round(entry.tokens / (entry.ms / 1000));
      texto += ` · ${entry.tokens} toks em ${Math.round(entry.ms / 1000)}s (${tokS} tok/s)`;
    }
    if (capturadoEm && analisadoEm.getTime() - capturadoEm.getTime() >= 1000) {
      texto += ` · frame analisado ${((analisadoEm.getTime() - capturadoEm.getTime()) / 1000).toFixed(1)}s depois`;
    }
    if (entry.motivo) {
      texto += ` · por ${rotuloMotivo(entry.motivo)}`;
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
  if (entry.nsfw && entry.nsfw.length > 0) {
    const nsfw = document.createElement("div");
    nsfw.className = "objs";
    for (const m of entry.nsfw) {
      const tag = document.createElement("span");
      tag.className = "tag nsfw";
      tag.textContent = `NSFW ${m.rotulo} ${(m.score * 100).toFixed(0)}%`;
      nsfw.appendChild(tag);
    }
    corpo.appendChild(nsfw);
  }
  li.appendChild(corpo);
  return li;
}

function addLogEntry(entry: EntradaLog): HTMLLIElement {
  const item = criarItem(entry);
  logEl.prepend(item);
  atualizarContagem();
  return item;
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

/**
 * Reidrata o contexto da sessao a partir da memoria persistida (roteiro recente
 * e ultima descricao), em vez de comecar sempre do zero.
 */
async function carregarContexto(): Promise<void> {
  try {
    const contexto = await api.obterContexto();
    if (!contexto) return;
    controlador().reidratarContexto(contexto.roteiro, contexto.ultimaDescricao);
  } catch {
    // memoria indisponivel; segue sem contexto reidratado
  }
}

async function limparHistorico(): Promise<void> {
  clearLogBtn.disabled = true;
  const retomar = running;
  try {
    // Limpar historico e um limite de contexto: nenhum evento novo pode depender
    // do estado temporal anterior nem surgir de um ciclo em andamento.
    if (retomar) controlador().pararAgendamento();
    await controlador().aguardarExecucao();

    // Pausa a fila e aguarda a gravacao em andamento antes de apagar no
    // servidor; em seguida a fila e descartada e volta a aceitar gravacoes.
    await filaPersistencia.pausar();
    await api.limparHistorico();
    filaPersistencia.limpar();

    // Reseta toda a percepcao temporal, nao apenas a lista visivel.
    controlador().reiniciarSessao();
    limparLista();
    atualizarContagem();
    setStatus("Historico limpo.");
  } catch (err) {
    setStatus(`Falha ao limpar historico: ${(err as Error).message}`);
    atualizarContagem();
  } finally {
    filaPersistencia.retomar();
    atualizarDiagnostico();
    if (retomar) await controlador().retomarAgendamento();
  }
}

function restaurarInterfaceIdle(): void {
  setSpinner(false);
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  placeholder.style.display = "grid";
  startBtn.disabled = false;
  stopBtn.disabled = true;
  analisarAgoraBtn.disabled = true;
  habilitarSeletoresDeMotor(true);
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

/**
 * Exporta as gravacoes que falharam de vez: eventos/entradas que nao chegaram
 * ao servidor e ficaram retidos na fila.
 */
function exportarPendentes(): void {
  const pendentes = filaPersistencia.naoEnviados;
  if (pendentes.length === 0) {
    setStatus("Nenhuma gravacao pendente.");
    return;
  }
  const blob = new Blob([JSON.stringify(pendentes, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  a.download = `neuro-vision-pendentes-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus(`${pendentes.length} gravacao(oes) pendente(s) exportada(s).`);
}

async function verificarVisao(): Promise<void> {
  try {
    const o = await api.saudeVisao();
    infoVisao = o;
    if (o?.online) {
      const memoria = o.carregados?.length ? ` · em memoria: ${o.carregados.join(", ")}` : "";
      modeloStatusEl.textContent = `LM Studio: online${o.modelos.length ? " (" + o.modelos.join(", ") + ")" : ""}${memoria}`;
      modeloStatusEl.className = "health online";
      modeloStatusEl.title = (o.modelos.join("\n") || "LM Studio acessivel") + (memoria ? `\n${memoria}` : "");
    } else {
      modeloStatusEl.textContent = `LM Studio: offline${o?.erro ? " — " + o.erro : ""}`;
      modeloStatusEl.className = "health offline";
      modeloStatusEl.title = o?.erro ?? "LM Studio inacessivel";
    }
  } catch {
    infoVisao = null;
    modeloStatusEl.textContent = "Backend de visao: servidor indisponivel";
    modeloStatusEl.className = "health offline";
    modeloStatusEl.title = "Servidor indisponivel";
  }
  atualizarOpcoesModeloVisao();
  atualizarDiagnostico();
}

// Repassa o status do detector (carga/inferencia YOLO ONNX) para a interface e
// mantem o diagnostico atualizado.
detectorCoco.aoStatus = (mensagem) => {
  setStatus(mensagem);
  atualizarDiagnostico();
};

startBtn.addEventListener("click", () => void controlador().iniciar());
stopBtn.addEventListener("click", () => controlador().parar());
analisarAgoraBtn.addEventListener("click", () => {
  if (!running || motorSelect.value !== "eventos") return;
  controlador().solicitarManual();
});
clearLogBtn.addEventListener("click", () => void limparHistorico());
exportBtn.addEventListener("click", () => void exportarLog());
exportPendentesBtn.addEventListener("click", exportarPendentes);
filterInput.addEventListener("input", aplicarFiltro);

intervalInput.addEventListener("input", () => {
  intervalValue.textContent = `${intervalInput.value}s`;
  intervaloMsConfigurado = Number(intervalInput.value) * 1000;
  controlador().reajustarAgendamento();
});

thresholdInput.addEventListener("input", () => {
  thresholdValue.textContent = Number(thresholdInput.value).toFixed(2);
});

motorSelect.addEventListener("change", () => {
  controlador().aoTrocarModo();
  atualizarBotoesAnalise();
  atualizarDiagnostico();
});

modeloVisaoSelect.addEventListener("change", () => {
  salvarModeloVisao();
  atualizarDiagnostico();
  const escolhido = modeloVisaoSelecionado();
  setStatus(
    escolhido
      ? `Modelo de visao: ${escolhido}. Ele sera carregado ao iniciar a analise.`
      : "Modelo de visao: padrao do servidor."
  );
});

nsfwToggle.addEventListener("change", () => {
  setStatus(
    nsfwToggle.checked
      ? "NSFW experimental: ligado. As marcacoes e a descricao explicita seguem no contexto, no prompt e na resposta."
      : "NSFW experimental: desligado."
  );
});

carregarModeloVisaoSalvo();
atualizarContagem();
atualizarDiagnostico();
void carregarHistorico();
void carregarContexto();
void verificarVisao();
