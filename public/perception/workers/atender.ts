import type {
  EscopoWorker,
  InfoCargaWorker,
  MotorWorker,
  RequisicaoWorker,
  RespostaWorker,
} from "./protocolo";

/**
 * Motor atendido por um worker. E o contrato interno minimo compartilhado por
 * `DetectorYoloOnnx`, `DetectorNsfwOnnx` e pelos adaptadores de pose/maos.
 */
export interface MotorAtendido {
  readonly modelo?: string | null;
  readonly dispositivo?: string | null;
  readonly versao?: string;
  readonly tempoCargaMs?: number | null;
  carregar(modelo: string, aoStatus?: (mensagem: string) => void): Promise<void>;
  executar(
    imagem: string,
    opcoes?: { threshold?: number; percentage?: boolean }
  ): Promise<unknown>;
  encerrar?(): void;
}

function mensagemDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Instala o atendimento RPC no worker atual.
 *
 * As inferencias de um mesmo worker sao **serializadas** internamente (fila em
 * cadeia): o runtime WASM nao se beneficia de duas chamadas concorrentes na mesma
 * sessao e pode falhar ao reentrar. O paralelismo real vem de workers distintos
 * (deteccao/pose/maos), que rodam ao mesmo tempo em nucleos diferentes.
 */
export function atenderWorker(motores: Partial<Record<MotorWorker, MotorAtendido>>): void {
  const escopo = self as unknown as EscopoWorker;
  let cadeia: Promise<unknown> = Promise.resolve();

  const responder = (mensagem: RespostaWorker): void => escopo.postMessage(mensagem);
  const enfileirar = <T>(tarefa: () => Promise<T>): Promise<T> => {
    const resultado = cadeia.then(tarefa, tarefa);
    cadeia = resultado.then(
      () => undefined,
      () => undefined
    );
    return resultado;
  };

  const atender = async (requisicao: RequisicaoWorker): Promise<unknown> => {
    const motor = motores[requisicao.motor];
    if (!motor) throw new Error(`motor ${requisicao.motor} desconhecido neste worker`);
    if (requisicao.tipo === "carregar") {
      await motor.carregar(requisicao.modelo, (mensagem) =>
        responder({ tipo: "status", motor: requisicao.motor, mensagem })
      );
      const info: InfoCargaWorker = {
        modelo: motor.modelo ?? requisicao.modelo,
        dispositivo: motor.dispositivo ?? null,
        versao: motor.versao,
        tempoCargaMs: motor.tempoCargaMs ?? null,
      };
      return info;
    }
    if (requisicao.tipo === "executar") {
      return motor.executar(requisicao.imagem, {
        threshold: requisicao.threshold,
        percentage: requisicao.percentage,
      });
    }
    motor.encerrar?.();
    return undefined;
  };

  escopo.onmessage = (evento) => {
    const requisicao = evento.data;
    if (!requisicao || typeof requisicao.id !== "number") return;
    enfileirar(() => atender(requisicao)).then(
      (valor) => responder({ id: requisicao.id, ok: true, valor }),
      (erro) => responder({ id: requisicao.id, ok: false, erro: mensagemDe(erro) })
    );
  };
}
