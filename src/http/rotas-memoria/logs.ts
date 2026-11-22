import { IncomingMessage } from "node:http";
import { ServerResponse } from "node:http";
import { ServicoMonitoramento } from "../../monitoramento/servico-monitoramento";
import { EntradaLogComVideo } from "../../types";
import { BODY_MAX_BYTES, arquivosDeMemoria, readBody, registrarFalha, sendJson } from "../base";
import {
  agendarLimpezaSnapshots,
  appendLogEntry,
  lerLogEntries,
  limparCiclosPersistidos,
  limparEventos,
  limparEventosTemporais,
  limparLog,
  limparSnapshots,
  salvarSnapshot,
  validarPayloadLog,
} from "../persistencia";
import { montarEntrada } from "../validacao";
import { auditarNulo, type RegistradorAuditoria } from "../auditoria";
import { anexarTrechosDeVideo } from "./video";

export async function handleLog(
  req: IncomingMessage,
  res: ServerResponse,
  logFile: string,
  snapDir: string,
  eventosFile: string
): Promise<void> {
  try {
    const raw = await readBody(req, BODY_MAX_BYTES);
    const payload: unknown = JSON.parse(raw || "{}");
    const erro = validarPayloadLog(payload);
    if (erro) {
      sendJson(res, 400, { ok: false, erro });
      return;
    }
    const entry = montarEntrada(payload);
    const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
      string,
      unknown
    >;
    const snapshot = await salvarSnapshot(p.snapshot, snapDir);
    if (snapshot) entry.snapshot = snapshot;
    await appendLogEntry(entry, logFile);
    if (snapshot) agendarLimpezaSnapshots(snapDir, logFile, eventosFile);
    sendJson(res, 200, { ok: true, entrada: entry });
  } catch (err) {
    sendJson(res, 400, { ok: false, erro: (err as Error).message });
  }
}

export async function handleListLogs(
  req: IncomingMessage,
  res: ServerResponse,
  logFile: string,
  monitoramento: ServicoMonitoramento
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/api/logs", "http://localhost");
    const limitParam = Number(url.searchParams.get("limit"));
    const limite = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 100;
    const entradas: EntradaLogComVideo[] = await anexarTrechosDeVideo(
      await lerLogEntries(logFile, limite),
      (entrada) => entrada.capturadoEm ?? entrada.timestamp,
      monitoramento
    );
    sendJson(res, 200, { ok: true, total: entradas.length, entradas });
  } catch (err) {
    registrarFalha("error", "listar_logs_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

export async function handleClearLogs(
  res: ServerResponse,
  logFile: string,
  snapDir: string,
  eventosFile: string,
  ciclosFile: string,
  eventosTemporaisFile: string,
  auditar: RegistradorAuditoria = auditarNulo
): Promise<void> {
  try {
    // "Limpar historico" apaga os dados persistidos: observacoes, eventos
    // visuais, memoria de gestos/posturas, diagnosticos de ciclo e os snapshots
    // que ficaram orfaos. Nao mexe no estado temporal em memoria do cliente —
    // esse reset e uma acao separada.
    await limparLog(logFile);
    await limparEventos(eventosFile);
    await limparEventosTemporais(eventosTemporaisFile);
    await limparCiclosPersistidos(ciclosFile);
    // Sem historico nem eventos, todos os snapshots ficam orfaos: a limpeza os
    // remove de imediato, mantendo o uso de disco limitado pela politica.
    const snapshots = await limparSnapshots({
      snapDir,
      logFiles: arquivosDeMemoria(logFile, eventosFile),
    });
    // A trilha de auditoria não é apagada junto: ela é o registro de quem
    // pediu a exclusão, inclusive deste pedido.
    auditar({
      acao: "exclusao_logs",
      resultado: "sucesso",
      alvo: "historico",
      detalhe: { snapshotsRemovidos: snapshots.removidos },
    });
    sendJson(res, 200, { ok: true, snapshots });
  } catch (err) {
    auditar({ acao: "exclusao_logs", resultado: "falha", alvo: "historico" });
    registrarFalha("error", "limpar_logs_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}
