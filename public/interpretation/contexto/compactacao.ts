import { KEYPOINTS_ESSENCIAIS } from "../esquema";
import type {
  ContextoCicloSerializavel,
  GrupoTruncamento,
  ObservacaoLocalSerializavel,
} from "../esquema";
import { tamanhoBytesUtf8 } from "./diagnostico";

/** Quantidade minima de evidencia textual de um evento preservada na compactacao. */
const MIN_EVIDENCIAS_EVENTO = 1;
/** Evidencias de frame mantidas por evento antes de uma poda mais agressiva. */
const MAX_EVIDENCIAS_EVENTO = 4;
/**
 * Margem reservada para o proprio registro `truncamento`, para que registrar a
 * poda nao empurre o payload de volta acima do teto.
 */
const RESERVA_TRUNCAMENTO_BYTES = 320;

/**
 * Reduz o contexto ate caber no teto, sem quebrar a correspondencia entre
 * frame e imagem. O criterio e **preservar a evidencia que sustenta uma
 * afirmacao** (Fase 3):
 *
 * 1. compacta landmarks de mao (mantendo gesto e geometria);
 * 2. reduz keypoints nao essenciais, preservando ombros, cotovelos, pulsos e
 *    quadris de cada pessoa;
 * 3. remove movimento (derivavel das posicoes);
 * 4. compacta evidencias de frames dos eventos, mantendo ao menos uma por
 *    evento (nunca ha perda silenciosa da unica evidencia);
 * 5. remove eventos nao confirmados (`candidato`/`incerto`); eventos
 *    `confirmado`/`encerrado` sao preservados;
 * 6. reduz deteccoes/pessoas/maos, priorizando maos com gesto ou geometria.
 *
 * `frameId`, timestamp, `versao`, o estado do subsistema, as **marcacoes NSFW**
 * e os eventos confirmados nunca sao removidos: quando o classificador esta
 * ativo, a informacao +18 e evidencia essencial. O teto e medido em **bytes
 * UTF-8** (`TextEncoder`), nao em unidades de string.
 *
 * Sempre que ha reducao, `contexto.truncamento` registra os grupos podados e as
 * contagens. Se o payload continuar acima do teto apos todas as reducoes, o
 * contexto tambem registra `limiteContexto` com `excedeu: true` — nunca falha em
 * silencio.
 */
export function limitarPorBytes(contexto: ContextoCicloSerializavel, maxBytes: number): void {
  const bytesAntes = tamanhoBytesUtf8(contexto);
  if (bytesAntes <= maxBytes) return;

  const remocoes = new Map<GrupoTruncamento, number>();
  const registrar = (grupo: GrupoTruncamento, removidos: number): void => {
    if (removidos <= 0) return;
    remocoes.set(grupo, (remocoes.get(grupo) ?? 0) + removidos);
  };
  // A reserva evita que o proprio metadado de truncamento estoure o teto.
  const cabe = (): boolean => tamanhoBytesUtf8(contexto) <= maxBytes - RESERVA_TRUNCAMENTO_BYTES;

  // 1. Landmarks de mao: mantem apenas pontas/articulacoes compactas. O gesto e
  // a geometria (calculada sobre os 21 pontos brutos) permanecem intactos.
  let removidos = 0;
  for (const frame of contexto.frames) {
    for (const mao of frame.maos) {
      if (mao.landmarks.length > 6) {
        removidos += mao.landmarks.length - 6;
        mao.landmarks = mao.landmarks.slice(0, 6);
        // O registro deixa de representar os 21 landmarks.
        mao.landmarksCompletos = false;
      }
    }
  }
  registrar("landmarks_mao", removidos);
  if (cabe()) return finalizar();

  // 2. Keypoints: preserva os essenciais (ombros, cotovelos, pulsos, quadris) e
  // completa com os demais mais confiaveis ate o limite compacto.
  const essenciais = new Set(KEYPOINTS_ESSENCIAIS);
  removidos = 0;
  for (const frame of contexto.frames) {
    for (const pessoa of frame.pessoas) {
      const pontosEssenciais = pessoa.keypoints.filter((k) => essenciais.has(k.nome));
      const outros = pessoa.keypoints.filter((k) => !essenciais.has(k.nome));
      const limiteOutros = Math.max(0, 6 - pontosEssenciais.length);
      const manter = new Set([...pontosEssenciais, ...outros.slice(0, limiteOutros)]);
      const reduzidos = pessoa.keypoints.filter((k) => manter.has(k));
      removidos += pessoa.keypoints.length - reduzidos.length;
      pessoa.keypoints = reduzidos;
    }
  }
  registrar("keypoints", removidos);
  if (cabe()) return finalizar();

  // 3. Movimento (derivavel de posicoes; menos critico que a evidencia bruta).
  removidos = 0;
  for (const frame of contexto.frames) {
    removidos += frame.movimento.length;
    frame.movimento = [];
  }
  registrar("movimento", removidos);
  if (cabe()) return finalizar();

  // 4. Evidencias de frames dos eventos: preserva a primeira e as mais recentes,
  // nunca abaixo de uma evidencia por evento.
  removidos = 0;
  for (const evento of contexto.eventosTemporais) {
    if (evento.evidencias.length > MAX_EVIDENCIAS_EVENTO) {
      const manter = Math.max(MIN_EVIDENCIAS_EVENTO, MAX_EVIDENCIAS_EVENTO - 1);
      const primeira = evento.evidencias[0];
      const ultimas = evento.evidencias.slice(-manter);
      const reduzidas = [...new Set([primeira, ...ultimas])];
      removidos += evento.evidencias.length - reduzidas.length;
      evento.evidencias = reduzidas;
    }
  }
  registrar("evidencias_eventos", removidos);
  if (cabe()) return finalizar();

  // 5. Eventos nao confirmados: candidato/incerto sao hipoteses; confirmado e
  // encerrado continuam preservados como evidencia do que foi observado.
  const naoPreservados = contexto.eventosTemporais.filter(
    (evento) => evento.status !== "confirmado" && evento.status !== "encerrado"
  ).length;
  if (naoPreservados > 0) {
    contexto.eventosTemporais = contexto.eventosTemporais.filter(
      (evento) => evento.status === "confirmado" || evento.status === "encerrado"
    );
    registrar("eventos_nao_confirmados", naoPreservados);
  }
  if (cabe()) return finalizar();

  // 6. Deteccoes/pessoas/maos. Maos com gesto ou geometria tem prioridade: sao a
  // evidencia direta de configuracao de dedos/gesto. Deteccoes cortadas viram
  // `deteccoesReduzidas`: evidencia compactada, nunca ausencia silenciosa.
  let removidosPessoas = 0;
  let removidosMaos = 0;
  for (const frame of contexto.frames) {
    compactarDeteccoes(frame, 3);
    removidosPessoas += Math.max(0, frame.pessoas.length - 2);
    frame.pessoas = frame.pessoas.slice(0, 2);
    const maosPriorizadas = [
      ...frame.maos.filter((mao) => mao.gesto || mao.geometria),
      ...frame.maos.filter((mao) => !mao.gesto && !mao.geometria),
    ];
    removidosMaos += Math.max(0, maosPriorizadas.length - 2);
    frame.maos = maosPriorizadas.slice(0, 2);
  }
  registrar("pessoas", removidosPessoas);
  registrar("maos", removidosMaos);
  if (cabe()) return finalizar();

  // 7. Ultimo passo: mantem uma deteccao/pessoa/mao por frame, ainda
  // priorizando maos com gesto/geometria.
  removidosPessoas = 0;
  removidosMaos = 0;
  for (const frame of contexto.frames) {
    compactarDeteccoes(frame, 1);
    removidosPessoas += Math.max(0, frame.pessoas.length - 1);
    frame.pessoas = frame.pessoas.slice(0, 1);
    removidosMaos += Math.max(0, frame.maos.length - 1);
    frame.maos = frame.maos.slice(0, 1);
  }
  registrar("pessoas", removidosPessoas);
  registrar("maos", removidosMaos);
  finalizar();

  /** Move o excedente para o resumo de evidencia reduzida no nivel do contexto. */
  function compactarDeteccoes(
    frame: ObservacaoLocalSerializavel,
    limite: number
  ): void {
    const excedente = frame.deteccoes.slice(limite);
    if (excedente.length === 0) return;
    frame.deteccoes = frame.deteccoes.slice(0, limite);
    const resumo = contexto.deteccoesReduzidas ?? [];
    for (const deteccao of excedente) {
      const rotulo = deteccao.rotulo;
      let grupo = resumo.find((item) => item.rotulo === rotulo);
      if (!grupo) {
        grupo = { rotulo, quantidade: 0, prioridades: [], trackIds: [] };
        resumo.push(grupo);
      }
      grupo.quantidade += 1;
      const prioridade = deteccao.proximidade?.prioridade ?? "contexto";
      if (!grupo.prioridades.includes(prioridade)) grupo.prioridades.push(prioridade);
      if (deteccao.trackId && !grupo.trackIds.includes(deteccao.trackId)) {
        grupo.trackIds.push(deteccao.trackId);
      }
    }
    contexto.deteccoesReduzidas = resumo;
    registrar("deteccoes_reduzidas", excedente.length);
  }

  function finalizar(): void {
    if (remocoes.size === 0) {
      // Sem grupos podaveis, o teto pode ainda ser inalcancavel (payload minimo
      // maior que o limite). Registra explicitamente em vez de falhar em silencio.
      const bytes = tamanhoBytesUtf8(contexto);
      if (bytes > maxBytes) {
        contexto.limiteContexto = { maxBytes, bytes, excedeu: true };
      }
      return;
    }
    const bytesDepois = tamanhoBytesUtf8(contexto);
    const gruposRemovidos = [...remocoes.entries()].map(([grupo, total]) => ({
      grupo,
      removidos: total,
    }));
    contexto.truncamento = {
      ocorreu: true,
      maxBytes,
      bytesAntes,
      bytesDepois,
      gruposRemovidos,
      excedeuTeto: bytesDepois > maxBytes,
    };
    const bytesComRegistro = tamanhoBytesUtf8(contexto);
    const excedeu = bytesComRegistro > maxBytes;
    contexto.truncamento.excedeuTeto = excedeu;
    if (excedeu) {
      // O campo nao entra na medicao de `bytes` (medido antes dele).
      contexto.limiteContexto = { maxBytes, bytes: bytesComRegistro, excedeu: true };
    }
  }
}
