import { expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../../../src/env";
import {
  LIMIAR,
  MODO,
  MODELO_VISAO,
  NSFW_ATIVO,
  VARIANTE_BASELINE,
  type PayloadAnalise,
} from "./ambiente";

interface ContextoValidacao {
  eventosDoClipe: Array<{ tipo?: string; timestamp?: string; descricao?: string }>;
  analisesDoClipe: PayloadAnalise[];
  analises: PayloadAnalise[];
  inicio: string;
  fimClipeMs: number;
}

export function validarResultados({
  eventosDoClipe,
  analisesDoClipe,
  analises,
  inicio,
  fimClipeMs,
}: ContextoValidacao): void {
    if (!VARIANTE_BASELINE) {
      expect(eventosDoClipe.length, "nenhum evento foi capturado (a deteccao nao rodou?)").toBeGreaterThan(0);
    }
    if (VARIANTE_BASELINE) {
      const diagnosticoAnalises = JSON.stringify({
        janela: { inicio, fim: new Date(fimClipeMs).toISOString() },
        recebidas: analises.map(({ capturadoEm, frameId, modelo, tipo }) => ({
          capturadoEm,
          frameId,
          modelo,
          tipo,
        })),
      });
      expect(
        analisesDoClipe.some(
          (a) =>
            a.tipo === "descricao" &&
            typeof a.frameId === "string" &&
            typeof a.modelo === "string" &&
            Number.isFinite(a.ms) &&
            (a.ms ?? -1) >= 0
        ),
        `nenhuma resposta multimodal real da variante A foi capturada dentro do clipe: ${diagnosticoAnalises}`
      ).toBe(true);
    }
    if (MODELO_VISAO) {
      expect(
        analisesDoClipe.some((a) => a.modelo === MODELO_VISAO),
        `nenhuma resposta foi produzida pelo modelo solicitado ${MODELO_VISAO}`
      ).toBe(true);
    }
    if (NSFW_ATIVO) {
      expect(
        analisesDoClipe.some((a) => Array.isArray(a.nsfw)),
        "nenhuma resposta incluiu o campo do marcador NSFW"
      ).toBe(true);
    }
}

interface ContextoArtefatos {
  clip: string;
  eventosDoClipe: Array<{ tipo?: string; timestamp?: string; descricao?: string }>;
  analisesDoClipe: PayloadAnalise[];
  inicio: string;
  duracaoVideoMs: number;
  duracaoMs: number;
  duracaoReproduzidaMs: number;
}

export async function salvarArtefatos({
  clip,
  eventosDoClipe,
  analisesDoClipe,
  inicio,
  duracaoVideoMs,
  duracaoMs,
  duracaoReproduzidaMs,
}: ContextoArtefatos): Promise<string> {
    const destino = path.resolve(env.E2E_WEBCAM_EVENTOS || "logs/webcam-eventos.jsonl");
    await mkdir(path.dirname(destino), { recursive: true });
    await writeFile(destino, eventosDoClipe.map((e) => JSON.stringify(e)).join("\n") + "\n");
    await writeFile(
      `${destino}.analises.jsonl`,
      analisesDoClipe.map((a) => JSON.stringify(a)).join("\n") + "\n"
    );
    // Base para os offsets `em` da anotacao (instante em que o clipe tocou).
    await writeFile(`${destino}.inicio`, `${inicio}\n`);
    await writeFile(
      `${destino}.config.json`,
      JSON.stringify(
        {
          clip: path.basename(clip),
          modo: MODO,
          limiar: LIMIAR,
          modeloVisao: MODELO_VISAO,
          nsfw: NSFW_ATIVO,
          inicio,
          duracaoVideoMs,
          duracaoMs,
          duracaoReproduzidaMs: Math.round(duracaoReproduzidaMs),
        },
        null,
        2
      ) + "\n"
    );
    if (VARIANTE_BASELINE) {
      const ciclos = analisesDoClipe
        .filter(
          (a) =>
            a.tipo === "descricao" &&
            typeof a.frameId === "string" &&
            typeof a.timestamp === "string" &&
            typeof a.capturadoEm === "string" &&
            typeof a.modelo === "string" &&
            a.modelo.length > 0 &&
            Number.isFinite(a.ms) &&
            (a.ms ?? -1) >= 0 &&
            Number.isFinite(Date.parse(a.timestamp)) &&
            Number.isFinite(Date.parse(a.capturadoEm)) &&
            Date.parse(a.timestamp) >= Date.parse(a.capturadoEm)
        )
        .map((a) => {
          const fimMs = Date.parse(a.timestamp!);
          const capturaMs = Date.parse(a.capturadoEm!);
          const totalMs = fimMs - capturaMs;
          const sessionId = a.sessaoId || `variante-a-${Date.parse(inicio)}`;
          return {
            sessionId,
            cycleId: a.frameId!,
            iniciadoEm: new Date(capturaMs).toISOString(),
            concluidoEm: a.timestamp,
            frameIds: [a.frameId!],
            observacoes: 1,
            eventosTemporais: 0,
            subsistemasIndisponiveis: [],
            erros: [],
            metricas: {
              totalMs,
              multimodalMs: a.ms!,
            },
            interpretacao: a.resumo,
            configuracao: {
              varianteId: "baseline",
              quantidadeSnapshotsConfigurada: 1,
              intervaloEntreSnapshotsMs: 1000,
              ...(a.modelo ? { modeloMultimodalEfetivo: a.modelo } : {}),
            },
            cancelado: false,
            registroEm: a.timestamp,
          };
        });
      await writeFile(
        `${destino}.ciclos.jsonl`,
        ciclos.map((c) => JSON.stringify(c)).join("\n") + "\n"
      );
      console.log(`Amostras da variante A: ${ciclos.length} | salvas em ${destino}.ciclos.jsonl`);
    }
  return destino;
}

interface ContextoResumo {
  inicio: string;
  inicioMs: number;
  duracaoReproduzidaMs: number;
  duracaoVideoMs: number;
  analisesDoClipe: PayloadAnalise[];
  eventosDoClipe: Array<{ tipo?: string; timestamp?: string; descricao?: string }>;
  destino: string;
}

export function imprimirResumo({
  inicio,
  inicioMs,
  duracaoReproduzidaMs,
  duracaoVideoMs,
  analisesDoClipe,
  eventosDoClipe,
  destino,
}: ContextoResumo): void {
    const base = inicioMs;
    const em = (ts?: string): number => (ts ? Math.round(Date.parse(ts) - base) : -1);
    console.log(`inicio (base da anotacao): ${inicio}`);
    console.log(`Limiar de deteccao: ${LIMIAR}`);
    console.log(`Modelo de visao: ${MODELO_VISAO ?? "(padrao do servidor)"}`);
    console.log(`Marcador NSFW: ${NSFW_ATIVO ? "ligado" : "desligado"}`);
    console.log(`Duracao reproduzida: ${Math.round(duracaoReproduzidaMs)}ms de ${duracaoVideoMs}ms`);
    console.log(`Analises do clipe: ${analisesDoClipe.length}`);
    for (const a of analisesDoClipe) console.log(`  +${em(a.timestamp)}ms  ${a.resumo ?? ""}`);
    console.log(`Eventos do clipe: ${eventosDoClipe.length}`);
    for (const e of eventosDoClipe) console.log(`  +${em(e.timestamp)}ms  ${e.tipo}  ${e.descricao ?? ""}`);
    console.log(`Analises do clipe: ${analisesDoClipe.length}`);
    for (const a of analisesDoClipe) {
      const marcacoes = a.nsfw?.map((marcacao) => marcacao.rotulo).join(", ") || "nenhuma";
      console.log(`  +${em(a.capturadoEm)}ms  ${a.modelo}  NSFW: ${marcacoes}  ${a.resumo ?? ""}`);
    }
    console.log(`Salvos em ${destino}`);
    console.log(`Analises salvas em ${destino}.analises.jsonl`);
    console.log(`Compare: npm run qualidade -- --anotacao <clipe>.json --eventos ${destino}`);
}
