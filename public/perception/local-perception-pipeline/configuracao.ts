import type { MetricasAdaptador } from "../contracts";
import { HABILITACAO_PADRAO } from "./tipos";
import type {
  ConfiguracaoParcial,
  DependenciasPipelineLocal,
  HabilitacaoSubsistemas,
  ModelosPercepcao,
  SubsistemaPercepcao,
} from "./tipos";
import { mensagemDe } from "./util";

function habilitado(
  subsistema: SubsistemaPercepcao,
  habilitacao: Required<HabilitacaoSubsistemas>
): boolean {
  return habilitacao[subsistema];
}

/**
 * Carrega os modelos de cada subsistema de forma **isolada** (itens 4 e 5):
 * um modelo que falha entra em `falhas` sem impedir o carregamento dos demais.
 * O pipeline segue rodando: o subsistema quebrado responde `indisponivel` em
 * cada frame, os outros continuam entregando evidencia.
 *
 * A ativacao e **explicita** (item 1): um subsistema so tenta carregar quando
 * esta habilitado **e** tem modelo. Desabilitado entra em `desativados` e nunca
 * toca o SDK.
 */
export async function configurarSubsistemas(
  deps: DependenciasPipelineLocal,
  modelos: ModelosPercepcao,
  aoStatus?: (mensagem: string) => void,
  habilitacao: HabilitacaoSubsistemas = HABILITACAO_PADRAO
): Promise<ConfiguracaoParcial> {
  const efetiva: Required<HabilitacaoSubsistemas> = { ...HABILITACAO_PADRAO, ...habilitacao };
  const alvos: {
    subsistema: SubsistemaPercepcao;
    porta?: {
      carregar(modelo: string, aoStatus?: (mensagem: string) => void): Promise<void>;
      metricas?: MetricasAdaptador;
    };
    modelo?: string;
  }[] = [
    { subsistema: "deteccao", porta: deps.detector, modelo: modelos.objetos },
    { subsistema: "pose", porta: deps.pose, modelo: modelos.pose },
    { subsistema: "maos", porta: deps.maos, modelo: modelos.maos },
    // NSFW experimental: toggle desligado (`habilitacao.nsfw`) ou sem modelo =
    // nada e carregado (e o pipeline omite o subsistema dos frames).
    { subsistema: "nsfw", porta: deps.nsfw, modelo: modelos.nsfw },
  ];

  const carregados: SubsistemaPercepcao[] = [];
  const desativados: SubsistemaPercepcao[] = [];
  const falhas: ConfiguracaoParcial["falhas"] = [];
  const carregamento: NonNullable<ConfiguracaoParcial["carregamento"]> = {};
  const status: ConfiguracaoParcial["status"] = {
    deteccao: "desativado",
    pose: "desativado",
    maos: "desativado",
    nsfw: "desativado",
  };

  for (const alvo of alvos) {
    if (!habilitado(alvo.subsistema, efetiva)) {
      desativados.push(alvo.subsistema);
      continue;
    }
    if (!alvo.porta || !alvo.modelo) {
      // Habilitado, mas sem porta ou sem id de modelo: nada a carregar.
      desativados.push(alvo.subsistema);
      continue;
    }
    try {
      await alvo.porta.carregar(alvo.modelo, aoStatus);
      carregados.push(alvo.subsistema);
      status[alvo.subsistema] = "carregado";
    } catch (err) {
      falhas.push({ subsistema: alvo.subsistema, motivo: mensagemDe(err) });
      status[alvo.subsistema] = "falhou";
      aoStatus?.(`${alvo.subsistema} indisponivel: ${mensagemDe(err)}`);
    }
    // Carga fria medida pelo adaptador (mesmo quando a carga falhou: o custo
    // gasto ate a falha continua sendo um custo de inicializacao observado).
    const metricas = alvo.porta.metricas;
    carregamento[alvo.subsistema] = {
      status: status[alvo.subsistema] === "carregado" ? "ok" : "indisponivel",
      modelo: metricas?.modelo,
      dispositivo: metricas?.dispositivo,
      versao: metricas?.versao,
      motivoFalha:
        status[alvo.subsistema] === "carregado" ? undefined : metricas?.motivoFalha,
      tempoCargaMs: metricas?.tempoCargaMs,
      memoriaBytes: metricas?.memoriaBytes,
    };
  }

  return { carregados, falhas, desativados, status, carregamento };
}
