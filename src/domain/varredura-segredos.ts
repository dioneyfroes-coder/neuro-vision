/**
 * Varredura heurística de segredos em texto (Fase 6, plano §12).
 *
 * Módulo puro: recebe trechos já extraídos e devolve **candidatos** para revisão
 * humana, nunca "ausência de segredo". Valores são redigidos antes de sair do
 * módulo — o segredo em si nunca aparece no relatório. Placeholders óbvios
 * (`<token>`, `exemplo`, `xxxx`, variáveis de template) são ignorados de propósito
 * para não transformar documentação em falso positivo.
 */

export interface TrechoVarreduraSegredos {
  caminho: string;
  linha: number;
  texto: string;
  origem?: "atual" | "historico";
}

export interface AchadoSegredos {
  caminho: string;
  linha: number;
  origem: "atual" | "historico";
  tipo: string;
  /** Nunca contém o valor completo — apenas prefixo curto e tamanho. */
  valorRedigido: string;
}

export interface RelatorioVarreduraSegredos {
  status: "limpo" | "candidatos" | "sem_dados";
  motivo?: string;
  trechos: number;
  totalAchados: number;
  achados: AchadoSegredos[];
  truncado: boolean;
  observacoes: string[];
}

interface Padrao {
  tipo: string;
  regex: RegExp;
  grupo?: number;
}

const SEPARADOR = "::";

const PADROES: readonly Padrao[] = [
  { tipo: "chave_privada", regex: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/gi },
  { tipo: "aws_access_key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { tipo: "token_github", regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gi },
  {
    tipo: "jwt",
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    tipo: "atribuicao_sensivel",
    regex: /(?:api[_-]?key|token|secret|senha|password|authorization|chave)\s*[:=]\s*["']?([A-Za-z0-9_+/=-]{24,})/gi,
    grupo: 1,
  },
  {
    tipo: "bearer_literal",
    regex: /\bBearer\s+([A-Za-z0-9._-]{24,})/gi,
    grupo: 1,
  },
  {
    tipo: "url_com_credencial",
    regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s@/]{4,})@/gi,
    grupo: 1,
  },
];

const PLACEHOLDER =
  /^(?:x{3,}|\*{3,}|\.{3,}|<.*>|\$\{.*\}|\{\{.*\}\}|true|false|null|undefined|example|exemplo|placeholder|dummy|fake|teste|test|changeme|change[-_]?me|seu[-_].*|your[-_].*)$/i;

function ehPlaceholder(valor: string): boolean {
  if (PLACEHOLDER.test(valor)) return true;
  return /example|exemplo|placeholder|dummy|fake|teste|changeme/i.test(valor);
}

function redigir(valor: string): string {
  return valor.length <= 6 ? "***" : `${valor.slice(0, 2)}…[${valor.length} chars]`;
}

function vazio(motivo: string): RelatorioVarreduraSegredos {
  return {
    status: "sem_dados",
    motivo,
    trechos: 0,
    totalAchados: 0,
    achados: [],
    truncado: false,
    observacoes: ["nenhum trecho fornecido: nao concluir que nao ha segredos"],
  };
}

export function varrerTrechosSegredos(
  trechos: ReadonlyArray<TrechoVarreduraSegredos> = [],
  limite = 100
): RelatorioVarreduraSegredos {
  const lista = trechos.filter(
    (trecho) => trecho && typeof trecho.texto === "string" && typeof trecho.caminho === "string"
  );
  if (lista.length === 0) return vazio("sem trechos para examinar");

  const achados: AchadoSegredos[] = [];
  const vistos = new Set<string>();
  let totalAchados = 0;
  const max = Number.isInteger(limite) && limite > 0 ? limite : 100;

  for (const trecho of lista) {
    const linha = Number.isInteger(trecho.linha) && trecho.linha > 0 ? trecho.linha : 1;
    for (const padrao of PADROES) {
      for (const correspondencia of trecho.texto.matchAll(padrao.regex)) {
        const valor = (padrao.grupo ? correspondencia[padrao.grupo] : correspondencia[0]) ?? "";
        if (valor.length > 0 && ehPlaceholder(valor)) continue;
        if (
          padrao.tipo === "atribuicao_sensivel" ||
          padrao.tipo === "bearer_literal" ||
          padrao.tipo === "url_com_credencial"
        ) {
          if (new Set(valor).size < 8) continue;
        }
        const chave = [trecho.caminho, String(linha), padrao.tipo].join(SEPARADOR);
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        totalAchados += 1;
        if (achados.length < max) {
          achados.push({
            caminho: trecho.caminho,
            linha,
            origem: trecho.origem ?? "atual",
            tipo: padrao.tipo,
            valorRedigido: redigir(valor),
          });
        }
      }
    }
  }

  return {
    status: totalAchados > 0 ? "candidatos" : "limpo",
    trechos: lista.length,
    totalAchados,
    achados,
    truncado: totalAchados > achados.length,
    observacoes: [
      "candidatos exigem revisao humana; padroes nao provam segredo nem ausencia dele",
      "valores sao redigidos e nunca sao reincorporados ao repositorio",
    ],
  };
}
