/**
 * Gravação segmentada do modo Câmera de Segurança (Fase 3).
 *
 * O gerenciador é **puro e determinístico**: não chama `Date.now()` nem conhece
 * codecs, disco ou HTTP. Quem grava entrega o instante de captura de cada
 * quadro; o gerenciador decide a qual segmento ele pertence, fecha segmentos no
 * limite exato, registra lacunas e devolve o `offsetMs` que o gravador usa para
 * montar o vídeo.
 *
 * Regras de cobertura:
 *
 * - segmentos normais cobrem `[inicioMs, fimMs)`; na rotação por duração o
 *   próximo começa exatamente no limite, sem perder nem sobrepor frames;
 * - em pausa, encerramento ou lacuna, `fimMs` é o **último quadro realmente
 *   gravado** — o trecho sem gravação não é anunciado como coberto;
 * - um intervalo entre quadros maior que `limiarLacunaMs` fecha o segmento como
 *   `incompleto` e registra a lacuna com motivo `sem_quadros`;
 * - um salto que atravessa um segmento inteiro sem quadros também vira lacuna,
 *   mesmo que o limiar configurado seja maior que a duração do segmento.
 *
 * Falhas não apagam o histórico: segmentos já fechados continuam consultáveis e
 * a interrupção fecha apenas o segmento em curso como `incompleto`.
 */

export type { ConfigGerenciadorGravacao, OpcoesSessaoMonitoramento } from "./gerenciador-gravacao/tipos";
export { GerenciadorGravacao } from "./gerenciador-gravacao/gerenciador";
