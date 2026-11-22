import type {
  EventoTemporal,
  MotivoEncerramentoEvento,
  OrigemSinalTemporal,
} from "../../../src/domain";
import { naturezaInteracao, transicaoPosse } from "../../../src/domain";
import type { EstadoPar } from "./tipos";
import { CONFIG_INTERACAO_PADRAO, type ConfigInteracao } from "./tipos";

type OpcoesEvento = Partial<Pick<ConfigInteracao, "framesParaContato" | "framesParaEncerrar">> & {
  motivoEncerramento?: MotivoEncerramentoEvento;
  primeiroConfirmado?: boolean;
};

export function eventoDe(
  par: EstadoPar,
  estado: "incerto" | "provavel" | "confirmado" | "encerrado",
  opcoes: OpcoesEvento = {}
): EventoTemporal {
  const descricao =
    estado === "confirmado"
      ? `Contato confirmado entre mao e${par.rotuloObjeto ? ` ${par.rotuloObjeto}` : " objeto"} (sobreposicao sustentada e mudanca de estado observada)`
      : estado === "provavel"
        ? `Provavel interacao com${par.rotuloObjeto ? ` ${par.rotuloObjeto}` : " objeto"} (proximidade sustentada; contato nao confirmado)`
        : estado === "incerto"
          ? `Proximidade entre mao e${par.rotuloObjeto ? ` ${par.rotuloObjeto}` : " objeto"} observada; contato nao confirmado`
          : `Interacao encerrada (grau maximo: ${par.grauMaximo})`;

  const grau =
    estado === "confirmado"
      ? "confirmado"
      : estado === "provavel"
        ? "provavel"
        : "incerto";
  const natureza = naturezaInteracao(
    {
      grau: estado === "encerrado" ? par.grauMaximo : grau,
      framesSobreposicao: par.framesSobreposicao,
      objetoMoveu: par.evidencias.some((evidencia) => evidencia.startsWith("objeto_moveu:")),
    },
    opcoes.framesParaContato ?? CONFIG_INTERACAO_PADRAO.framesParaContato
  );
  const posse = transicaoPosse(
    {
      grau: estado,
      grauMaximo: par.grauMaximo,
      motivoEncerramento: opcoes.motivoEncerramento,
      continuidadeValida: par.continuidadeValida,
      framesObjetoEstavel: par.framesObjetoEstavel,
      primeiroConfirmado: opcoes.primeiroConfirmado,
    },
    opcoes.framesParaEncerrar ?? CONFIG_INTERACAO_PADRAO.framesParaEncerrar
  );

  return {
    eventoId: par.eventoId,
    sessionId: par.sessionId,
    cycleId: par.cycleIdInicio,
    tipo: "interacao_objeto",
    inicioEm: par.inicioEm,
    fimEm: estado === "encerrado" ? par.ultimaEvidenciaEm : undefined,
    ultimaEvidenciaEm: par.ultimaEvidenciaEm,
    ultimaObservacaoEm: par.ultimaObservacaoEm,
    entidadeId: par.objetoEntidadeId,
    participantes: [par.maoEntidadeId, par.objetoEntidadeId],
    ...(par.pessoaEntidadeId ? { pessoaEntidadeId: par.pessoaEntidadeId } : {}),
    naturezaInteracao: natureza,
    ...(posse ? { transicaoPosse: posse } : {}),
    rotuloObjeto: par.rotuloObjeto,
    descricao,
    confianca: par.confianca,
    origens: ["maos", "objetos"] as OrigemSinalTemporal[],
    frameIds: [...par.frameIds],
    estado,
    motivoEncerramento:
      estado === "encerrado"
        ? (opcoes.motivoEncerramento ?? "sem_sinal")
        : undefined,
    continuidadeValida: par.continuidadeValida,
    evidencias: [...par.evidencias, `grau:${par.grauMaximo}`],
  };
}

export function adicionarFrame(frames: string[], frameId: string | undefined): void {
  if (!frameId) return;
  if (frames[frames.length - 1] !== frameId) frames.push(frameId);
}

export function adicionarEvidencia(evidencias: string[], evidencia: string): void {
  if (evidencias.includes(evidencia)) return;
  if (evidencias.length >= 12) return;
  evidencias.push(evidencia);
}
