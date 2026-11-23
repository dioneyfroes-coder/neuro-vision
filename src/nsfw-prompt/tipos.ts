import type { Caixa } from "../types";
import type { EscopoClasseNsfw, TipoClasseNsfw, UsoPermitidoNsfw } from "../domain/nsfw-classificacao-rotulo";

/** Marcacao NSFW pronta para prompt/UI (caixa normalizada em [0, 1]). */
export interface MarcacaoNsfwVisivel {
  rotulo: string;
  score: number;
  caixa: Caixa;
  /** Modelo de maior score que produziu a marcacao, quando conhecido. */
  modelo?: string;
  /** Modelos que concordaram com a mesma regiao/rotulo (evidencia somada). */
  modelos?: string[];
  /** Tempo real do frame que produziu a marcação (Fase 4). */
  frameId?: string;
  capturadoEm?: string;
  capturadoEmMs?: number;
  offsetMs?: number;
  /** `false` quando não há carimbo confiável — nunca é substituído por "agora". */
  tempoConfiavel?: boolean;
  /** Metadados estruturais da classe (Fase 4); ausentes em payloads antigos. */
  tipoClasse?: TipoClasseNsfw;
  escopoClasse?: EscopoClasseNsfw;
  usoPermitido?: UsoPermitidoNsfw;
}

/** Marcacoes de uma imagem especifica no prompt multimodal. */
export interface QuadroNsfwPrompt {
  /** Indice 1-based da imagem correspondente, na ordem enviada ao modelo. */
  indice: number;
  /** Id real do frame, quando disponivel. */
  frameId?: string;
  marcacoes: ReadonlyArray<MarcacaoNsfwVisivel>;
}
