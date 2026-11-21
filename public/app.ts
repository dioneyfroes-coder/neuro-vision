import { obterModo } from "./modos";
import { MotorVisao } from "./motores";
import { FilaPersistencia } from "./persistencia";
import * as api from "./api";
import { CycleController } from "./cycle/cycle-controller";
import type { ControladorCiclo, EventoUi, ItemHistorico } from "./cycle/cycle-controller";
import { CicloPercepcaoController } from "./cycle/ciclo-percepcao-controller";
import { criarPercepcaoLocal } from "./perception/percepcao-local";
import { obterVariante } from "./perception/variantes";
import type { VariantePercepcao } from "./perception/variantes";
import type { HabilitacaoSubsistemas } from "./perception/local-perception-pipeline";
import { MODELO_NSFW_CONJUNTO, MODELOS_NSFW_CONJUNTO } from "./nsfw-onnx";
import { MODELO_NSFW, resolverModeloVisao } from "../src/nsfw-prompt";
import { MotorTemporalImpl } from "./temporal/motor-temporal";
import { InterpretadorCiclo } from "./interpretation/interpretador-ciclo";
import { criarTransporteServidor } from "./interpretation/transporte-servidor";
import { criarModuloMonitoramento } from "./ui/monitoramento";
import {
  camera,
  ctx,
  overlay,
  placeholder,
  statusEl,
  spinnerEl,
  modeloStatusEl,
  diagInfoEl,
  persistAvisoEl,
  logEl,
  clearLogBtn,
  exportBtn,
  exportPendentesBtn,
  filterInput,
  timelineAtualizarBtn,
  timelineBuscaInput,
  timelineEventosEl,
  startBtn,
  stopBtn,
  analisarAgoraBtn,
  modelSelect,
  modeloVisaoSelect,
  motorSelect,
  intervalInput,
  intervalValue,
  thresholdInput,
  thresholdValue,
  nsfwToggle,
  contextoInput,

} from "./ui/elementos";
import {
  classificadorNsfw,
  configuracaoCaptura,
  detectorCoco,
  politicaCiclo,
} from "./ui/configuracao";
import {
  adicionarBotoesEvidencia,
  atualizarContagem,
  criarItem,
  drawBoxes,
  rotuloInstante,
  type EntradaComVideoOpcional,
} from "./ui/renderizacao";

let running = false;
let intervaloMsConfigurado = Number(intervalInput.value) * 1000;

/** Fila de persistencia: serializa gravacoes, retenta falhas transitorias e alimenta o diagnostico. */
const filaPersistencia = new FilaPersistencia({
  aoMudar: () => atualizarDiagnostico(),
});

/** Ultimo status do backend de visao conhecido (motor/modelos/carregados), para o diagnostico. */
let infoVisao: api.InfoVisao | null = null;
/** Recursos do servidor medidos no health (Fase 6). */
let infoSistema: api.InfoSistema | null = null;

const {
  monitoramento,
  monitorAtivo,
  atualizarBotoesMonitoramento,
  encerrarMonitoramento,
  registrarEventos: registrarEventosMonitoramento,
} = criarModuloMonitoramento({
  setStatus,
  atualizarDiagnostico,
  obterDescricaoAtual: () => undefined,
});

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
      atualizarBotoesMonitoramento();
      atualizarDiagnostico();
      // O modelo de visao pode ter subido junto com a inicializacao.
      void verificarVisao();
      return;
    case "falha_inicializacao":
      running = false;
      restaurarInterfaceIdle();
      atualizarBotoesMonitoramento();
      atualizarDiagnostico();
      setStatus(evento.mensagem);
      return;
    case "parado":
      running = false;
      restaurarInterfaceIdle();
      atualizarBotoesMonitoramento();
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
    gravarOperacional: (registro) => api.gravarOperacional(registro).then(() => undefined),
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
      modeloVisao: modeloVisaoEfetivo(),
      obterThreshold: () => Number(thresholdInput.value),
    });
  },
  criarMotorVisao: (opcoes) => new MotorVisao(opcoes),
  obterModeloVisao: () => modeloVisaoEfetivo(),
  obterIntervaloMs: () => intervaloMsConfigurado,
  classificadorNsfw,
  // So carrega quando o toggle esta ligado no inicio da sessao; desligado, o
  // modo de frame unico roda exatamente como antes. O id e o conjunto: todos os
  // modelos do catalogo rodam, sem seletor.
  obterModeloNsfw: () => (nsfwToggle.checked ? MODELO_NSFW_CONJUNTO : undefined),
  obterContexto: contextoDeclarado,
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
    gravarEventoTemporal: api.gravarEventoTemporal,
    gravarOperacional: (registro) => api.gravarOperacional(registro).then(() => undefined),
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
    // O id composto dispara o conjunto inteiro, sem seletor de modelo.
    nsfw: nsfwToggle.checked ? MODELO_NSFW_CONJUNTO : undefined,
  }),
  // Regras de pose compativel (Fase 7.2) so entram com o NSFW ativo; em SFW o
  // motor temporal continua exatamente como antes. O toggle fica bloqueado
  // durante a captura, entao o valor no inicio da sessao e estavel.
  criarMotorTemporal: (modo) =>
    new MotorTemporalImpl({ modo, avaliarPoseSexual: nsfwToggle.checked }),
  criarInterpretador: () =>
    new InterpretadorCiclo({
      enviar: criarTransporteServidor(),
      // Getter dinamico: segue a selecao atual da interface, mesmo que ela
      // mude (ou seja preenchida) depois do inicio da sessao. Sem escolha
      // explicita, registra o modelo efetivo do backend (o que o /api/health
      // reporta) — nunca o fallback "multiframe", para a verificacao de mesmo
      // modelo da Etapa 9 valer em qualquer execucao.
      modelo: () => modeloVisaoEfetivo() ?? infoVisao?.modelo ?? undefined,
      nsfwAtivo: () => nsfwAtivo(),
      contextoDeclarado,
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

/**
 * NSFW realmente ativo na sessao: no multiframe depende de a variante rodar a
 * percepcao local; nos modos de frame unico, basta o toggle ligado.
 */
function nsfwAtivo(): boolean {
  const definicao = obterModo(motorSelect.value);
  if (definicao.multiframe) return montarHabilitacao().nsfw === true;
  return nsfwToggle.checked;
}

/**
 * Contexto/metadado declarado pelo usuario (nome do clipe, anotacao). Vazio =
 * nenhum contexto. O prompt o trata como declaracao, nunca como observacao.
 */
function contextoDeclarado(): string | undefined {
  return contextoInput.value.trim() || undefined;
}

/**
 * Modelo efetivo de visao: com NSFW ativo vale sempre `MODELO_NSFW`; desligado,
 * respeita a escolha da interface (`undefined` = padrao do servidor).
 */
function modeloVisaoEfetivo(): string | undefined {
  return resolverModeloVisao(modeloVisaoSelecionado(), nsfwAtivo());
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

/** Rotulo curto do conjunto NSFW para status/diagnostico. */
function rotuloConjuntoNsfw(): string {
  return `conjunto NSFW (${MODELOS_NSFW_CONJUNTO.length} modelos)`;
}

function motivoSemModelosVisao(): string {
  if (!infoVisao) return "Não foi possível consultar o backend de visão.";
  if (infoVisao.online === false) {
    const onde = infoVisao.backend ? ` em ${infoVisao.backend}` : "";
    const erro = infoVisao.erro ? ` (${infoVisao.erro})` : "";
    return `Backend offline${onde}${erro} — inicie o LM Studio ou ajuste NEURO_BASE_URL.`;
  }
  const onde = infoVisao.backend ? ` em ${infoVisao.backend}` : "";
  return `Nenhum modelo de visão instalado${onde}.`;
}

/**
 * Preenche o seletor de modelo de visao com os modelos instalados no backend
 * (`GET /api/health`) e preserva a escolha atual, mesmo que ela nao esteja na
 * lista (backend offline ou modelo desinstalado). Sem modelos, o seletor mostra
 * um aviso explicito em vez de parecer vazio.
 */
function atualizarOpcoesModeloVisao(): void {
  const atual = modeloVisaoSelect.value.trim();
  // Modelos de embedding nunca respondem a visao: filtra por nome.
  const instalados = (infoVisao?.modelos ?? []).filter((id) => !/embed/i.test(id));
  const ids = ["", ...instalados];
  if (atual && !instalados.includes(atual)) ids.splice(1, 0, atual);

  const opcoes = ids.map((id) => {
    const opcao = document.createElement("option");
    opcao.value = id;
    opcao.textContent = id || "Padrão do servidor";
    return opcao;
  });
  if (instalados.length === 0) {
    const aviso = document.createElement("option");
    aviso.value = "__sem_modelos__";
    aviso.disabled = true;
    aviso.textContent = motivoSemModelosVisao();
    opcoes.splice(1, 0, aviso);
  }

  modeloVisaoSelect.replaceChildren(...opcoes);
  modeloVisaoSelect.value = atual;
  modeloVisaoSelect.title = instalados.length
    ? `Instalados no backend${infoVisao?.backend ? ` (${infoVisao.backend})` : ""}:\n${instalados.join("\n")}`
    : motivoSemModelosVisao();
}

/**
 * Linha de diagnostico: motor ativo, modelo solicitado, modelo carregado no
 * backend e separacao entre carga, inferencia e persistencia.
 */
function atualizarDiagnostico(): void {
  const motor = running ? motorSelect.value : "parado";
  const definicao = obterModo(motorSelect.value);
  const deteccao = modeloDeDeteccaoAtivo();
  const modeloVisao = modeloVisaoEfetivo() ?? infoVisao?.modelo ?? "?";
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
  if (nsfwAtivo()) partes.push(`nsfw ${rotuloConjuntoNsfw()}`);
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

  if (infoSistema) {
    const s = infoSistema;
    const cpu = s.cpu.usoPercentual === null ? "?" : `${s.cpu.usoPercentual.toFixed(1)}%`;
    const ram = (s.ram.rssBytes / 1048576).toFixed(0);
    const video = (s.armazenamento.bytesTotal / 1048576).toFixed(1);
    partes.push(`servidor cpu ${cpu} · ram ${ram}MiB · videos ${video}MiB`);
    // GPU nunca e inventada: so aparece se o servidor tiver medicao real.
    if (s.gpu.utilizacaoPercentual !== null) {
      partes.push(`gpu ${s.gpu.utilizacaoPercentual.toFixed(1)}%`);
    }
  }

  const estadoGravacao = monitoramento.estadoAtual;
  if (estadoGravacao !== "parada") {
    partes.push(`gravacao ${estadoGravacao}`);
    if (monitoramento.segmentoAtual) partes.push(`segmento ${monitoramento.segmentoAtual}`);
    if (monitoramento.uploadsPendentes > 0) {
      partes.push(`uploads pendentes ${monitoramento.uploadsPendentes}`);
    }
  }

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
  // nao teria efeito, entao o toggle tambem bloqueia junto.
  nsfwToggle.disabled = !habilitado;
}

function addLogEntry(entry: EntradaComVideoOpcional): HTMLLIElement {
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

/**
 * Histórico de gravações/cenas da Câmera de Segurança.
 * Fonte principal: sessões/segmentos de monitoramento; descrições vêm de entradas/ciclos
 * correlacionados por sessão e janela de tempo. Busca única filtra descrição/objeto/ambiente/data.
 */
async function carregarLinhaDoTempo(): Promise<void> {
  timelineAtualizarBtn.disabled = true;
  try {
    const termo = timelineBuscaInput.value.trim().toLowerCase();
    const [sessoes, entradas, ciclos] = await Promise.all([
      api.listarSessoesMonitoramento(100).catch(() => []),
      api.listarEntradas(500).catch(() => [] as EntradaComVideoOpcional[]),
      api.listarCiclos(500).catch(() => []),
    ]);
    const segmentosPorSessao = new Map<string, Awaited<ReturnType<typeof api.listarSegmentosDaSessao>>>();
    await Promise.all(sessoes.map(async (s) => {
      segmentosPorSessao.set(s.sessaoId, await api.listarSegmentosDaSessao(s.sessaoId, 500).catch(() => []));
    }));

    const itens: Array<{sessaoId:string; ambiente:string; inicioMs:number; dataHora:string; segmentos:Array<{segmentoId:string; inicioMs:number; fimMs:number; url:string; sequencia:number; incompleto?:boolean}>; descricoes:string[]}> = [];
    for (const sessao of sessoes) {
      const segmentos = (segmentosPorSessao.get(sessao.sessaoId) ?? []).slice().sort((a,b)=>a.inicioMs-b.inicioMs);
      const inicioMs = sessao.iniciadaEmMs;
      const fimMs = sessao.encerradaEmMs ?? Date.now();
      const descricoes: string[] = [];
      for (const e of entradas) {
        const ms = Date.parse(e.capturadoEm ?? e.timestamp);
        const emJanela = Number.isFinite(ms) && ms >= inicioMs - 5000 && ms <= fimMs + 5000;
        if ((e.sessaoId === sessao.sessaoId || (!e.sessaoId && emJanela)) && e.resumo?.trim()) descricoes.push(e.resumo.trim());
      }
      for (const c of ciclos) {
        if (c.sessionId === sessao.sessaoId && c.interpretacao?.trim()) descricoes.push(c.interpretacao.trim());
      }
      const dataHora = rotuloInstante(sessao.iniciadaEm);
      const texto = [sessao.ambiente, dataHora, sessao.sessaoId, ...descricoes].join(" ").toLowerCase();
      if (termo && !texto.includes(termo)) continue;
      itens.push({
        sessaoId: sessao.sessaoId, ambiente: sessao.ambiente, inicioMs, dataHora,
        descricoes: [...new Set(descricoes)].slice(0, 8),
        segmentos: segmentos.map((s)=>({ segmentoId:s.segmentoId, inicioMs:s.inicioMs, fimMs:s.fimMs, url:api.urlVideoSegmento(s.segmentoId), sequencia:s.sequencia, incompleto:s.estado === "incompleto" })),
      });
    }

    itens.sort((a,b)=>b.inicioMs-a.inicioMs);
    timelineEventosEl.replaceChildren();
    if (itens.length === 0) {
      const vazio = document.createElement("li");
      vazio.className = "timeline-vazio";
      vazio.textContent = termo ? "Nenhuma gravação/cena encontrada para a pesquisa." : "Nenhuma gravação de câmera de segurança encontrada.";
      timelineEventosEl.append(vazio);
      return;
    }

    for (const item of itens) {
      const li = document.createElement("li");
      li.className = "timeline-item";
      const cab = document.createElement("div");
      cab.className = "timeline-item-head";
      cab.textContent = `${item.dataHora} — ${item.ambiente}`;
      li.appendChild(cab);
      const meta = document.createElement("small");
      meta.textContent = `sessão ${item.sessaoId} • ${item.segmentos.length} segmento(s)`;
      li.appendChild(meta);
      if (item.descricoes.length > 0) {
        for (const d of item.descricoes) { const p = document.createElement("p"); p.textContent = d; li.appendChild(p); }
      } else {
        const p = document.createElement("p"); p.className = "timeline-sem-video"; p.textContent = "Sem descrição de cena registrada para esta sessão."; li.appendChild(p);
      }
      if (item.segmentos.length > 0) {
        adicionarBotoesEvidencia(li, item.segmentos.map((s)=>({ segmentoId:s.segmentoId, sessaoId:item.sessaoId, url:s.url, inicioMs:s.inicioMs, fimMs:s.fimMs, offsetMs:0, ateMs:Math.max(0,s.fimMs-s.inicioMs), duracaoTrechoMs:Math.max(0,s.fimMs-s.inicioMs), sequencia:s.sequencia, incompleto:!!s.incompleto, lacunas:[] })), item.ambiente);
      } else {
        const sv = document.createElement("span"); sv.className = "timeline-sem-video"; sv.textContent = "Sem vídeo disponível para esta sessão."; li.appendChild(sv);
      }
      timelineEventosEl.append(li);
    }
  } catch (err) {
    const falha = document.createElement("li");
    falha.className = "timeline-vazio";
    falha.textContent = `Falha ao consultar histórico: ${(err as Error).message}`;
    timelineEventosEl.replaceChildren(falha);
  } finally {
    timelineAtualizarBtn.disabled = false;
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
    const saude = await api.saudeSistema();
    const o = saude.visao;
    infoVisao = o;
    infoSistema = saude.sistema;
    if (o?.online) {
      const memoria = o.carregados?.length ? ` · em memoria: ${o.carregados.join(", ")}` : "";
      modeloStatusEl.textContent = `LM Studio: online${o.modelos.length ? " (" + o.modelos.join(", ") + ")" : ""}${memoria}`;
      modeloStatusEl.className = "health online";
      modeloStatusEl.title = (o.modelos.join("\n") || "LM Studio acessivel") + (memoria ? `\n${memoria}` : "");
    } else {
      const onde = o?.backend ? ` (${o.backend})` : "";
      modeloStatusEl.textContent = `LM Studio: offline${onde}${o?.erro ? " — " + o.erro : ""}`;
      modeloStatusEl.className = "health offline";
      modeloStatusEl.title = o?.erro ?? "LM Studio inacessivel";
    }
  } catch {
    infoVisao = null;
    infoSistema = null;
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
stopBtn.addEventListener("click", () => {
  void (async () => {
    // O stream da câmera será interrompido: feche a gravação antes disso.
    if (monitorAtivo()) await encerrarMonitoramento();
    controlador().parar();
  })();
});

registrarEventosMonitoramento();

analisarAgoraBtn.addEventListener("click", () => {
  if (!running || motorSelect.value !== "eventos") return;
  controlador().solicitarManual();
});
clearLogBtn.addEventListener("click", () => void limparHistorico());
exportBtn.addEventListener("click", () => void exportarLog());
exportPendentesBtn.addEventListener("click", exportarPendentes);
filterInput.addEventListener("input", aplicarFiltro);
timelineAtualizarBtn.addEventListener("click", () => void carregarLinhaDoTempo());
timelineBuscaInput.addEventListener("input", () => void carregarLinhaDoTempo());

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

// Se o backend ainda nao estava no ar quando a pagina abriu, atualiza a lista
// ao voltar o foco para a janela ou ao abrir o seletor.
function atualizarVisaoSeVazia(): void {
  if (!infoVisao?.online || (infoVisao.modelos ?? []).length === 0) {
    void verificarVisao();
  }
}
modeloVisaoSelect.addEventListener("focus", atualizarVisaoSeVazia);
window.addEventListener("focus", atualizarVisaoSeVazia);

nsfwToggle.addEventListener("change", () => {
  setStatus(
    nsfwAtivo()
      ? `NSFW experimental: ligado. ${rotuloConjuntoNsfw()} e visao ${MODELO_NSFW}; cada modelo roda em seu proprio worker e as marcacoes sao mescladas. A descricao explicita segue no contexto, no prompt e na resposta.`
      : nsfwToggle.checked
        ? "NSFW experimental: ligado, mas o modo atual nao roda a percepcao local (NSFW inativo)."
        : "NSFW experimental: desligado."
  );
  atualizarDiagnostico();
});

carregarModeloVisaoSalvo();
atualizarContagem();
atualizarBotoesMonitoramento();
atualizarDiagnostico();
void carregarHistorico();
void carregarLinhaDoTempo();
void carregarContexto();
void verificarVisao();