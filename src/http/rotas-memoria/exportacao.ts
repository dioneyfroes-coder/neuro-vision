/**
 * `GET /api/eventos/exportar` — exportação auditável do histórico de eventos.
 *
 * Usa o mesmo recorte de consulta da linha do tempo e o schema canônico; não
 * cria um formato concorrente. O cabeçalho de metadados inclui versão do schema,
 * instante de geração (do servidor), sessão pedida e filtros aplicados.
 */
import type { ServerResponse } from "node:http";
import { IncomingMessage } from "node:http";
import {
  VERSAO_ESQUEMA_EVENTO,
  filtrarEventosTemporais,
  registroDeEventoVisual,
  registroDeEventoTemporal,
  serializarEventos,
  type FormatoExportacaoEventos,
  type RegistroExportacaoEventos,
} from "../../domain";
import { lerEventos, lerEventosTemporais } from "../persistencia";
import { registrarFalha } from "../base";
import { auditarNulo, type RegistradorAuditoria } from "../auditoria";
import { descreverFiltros, parsearFiltrosEventosTemporais } from "./filtros";

const LIMITE_EXPORTACAO = 20_000;

function nomeArquivo(formato: FormatoExportacaoEventos, geradoEm: string): string {
  const stamp = geradoEm.slice(0, 19).replace(/[:T]/g, "-");
  return `neuro-vision-eventos-${stamp}.${formato}`;
}

export async function handleExportarEventos(
  req: IncomingMessage,
  res: ServerResponse,
  eventosFile: string,
  eventosTemporaisFile: string,
  auditar: RegistradorAuditoria = auditarNulo
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/api/eventos/exportar", "http://localhost");
    const formato: FormatoExportacaoEventos =
      url.searchParams.get("formato")?.toLowerCase() === "csv" ? "csv" : "jsonl";
    const filtros = parsearFiltrosEventosTemporais(url);
    const [temporais, visuais] = await Promise.all([
      lerEventosTemporais(eventosTemporaisFile, LIMITE_EXPORTACAO),
      lerEventos(eventosFile, LIMITE_EXPORTACAO),
    ]);

    const registros: RegistroExportacaoEventos[] = [
      ...filtrarEventosTemporais(temporais, filtros).map((evento) =>
        registroDeEventoTemporal(evento)
      ),
      ...visuais
        .filter((evento) => {
          if (filtros.sessionId && evento.sessaoId !== filtros.sessionId) return false;
          if (filtros.tipos?.length && !filtros.tipos.includes(evento.tipo)) return false;
          const objeto = evento.objetoId ?? evento.rotuloObjeto;
          if (filtros.objetos?.length && (!objeto || !filtros.objetos.includes(objeto))) {
            return false;
          }
          const instante = Date.parse(evento.timestamp);
          if (filtros.desdeMs !== undefined && Number.isFinite(instante) && instante < filtros.desdeMs) {
            return false;
          }
          if (filtros.ateMs !== undefined && Number.isFinite(instante) && instante > filtros.ateMs) {
            return false;
          }
          return true;
        })
        .map((evento) => registroDeEventoVisual(evento)),
    ].sort((a, b) => Date.parse(b.inicioEm) - Date.parse(a.inicioEm));

    auditar({
      acao: "exportacao_eventos",
      resultado: "sucesso",
      alvo: filtros.sessionId ? `sessao:${filtros.sessionId}` : "eventos",
      detalhe: { formato, registros: registros.length },
    });
    const geradoEm = new Date().toISOString();
    const conteudo = serializarEventos(registros, formato, {
      geradoEm,
      versaoEsquema: VERSAO_ESQUEMA_EVENTO,
      sessaoId: filtros.sessionId,
      filtros: descreverFiltros(url),
    });
    res.writeHead(200, {
      "Content-Type":
        formato === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nomeArquivo(formato, geradoEm)}"`,
      "Cache-Control": "no-store",
    });
    res.end(conteudo);
  } catch (err) {
    auditar({ acao: "exportacao_eventos", resultado: "falha", alvo: "eventos" });
    registrarFalha("error", "exportar_eventos_falhou", { erro: (err as Error).message });
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    }
    res.end(JSON.stringify({ ok: false, erro: (err as Error).message }));
  }
}
