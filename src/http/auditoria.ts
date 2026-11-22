/**
 * Escritor da trilha de auditoria (Fase 7).
 *
 * Centraliza o tipo de callback usado pelas rotas e pelo gateway de
 * autenticação. A gravação é best-effort: falha na trilha não derruba a
 * requisição, mas gera um registro operacional para não passar despercebida.
 */
import { criarRegistroAuditoria, type RegistradorAuditoria } from "../domain/auditoria";
import { gravarAuditoria } from "../persistence/repositorio-auditoria";
import { LOG_MAX_BYTES, registrarFalha } from "./base";

export type { RegistradorAuditoria };

/** Cria um registrador já associado ao ator e ao arquivo desta requisição. */
export function criarAuditar(auditoriaFile: string, ator: string): RegistradorAuditoria {
  return (opcoes) => {
    const registro = criarRegistroAuditoria({
      acao: opcoes.acao,
      resultado: opcoes.resultado,
      ator: opcoes.ator ?? ator,
      alvo: opcoes.alvo,
      detalhe: opcoes.detalhe,
    });
    void gravarAuditoria(registro, auditoriaFile, LOG_MAX_BYTES).catch((erro: unknown) => {
      registrarFalha("error", "auditoria_falhou", {
        registroId: registro.registroId,
        erro: (erro as Error).message,
      });
    });
  };
}

/** Registrador inerte para rotas chamadas fora do servidor (testes/CLI). */
export const auditarNulo: RegistradorAuditoria = () => undefined;
