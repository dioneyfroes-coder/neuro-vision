/**
 * Regras geometricas de **pose compativel** com ato sexual (Fase 7.2).
 *
 * Estas regras NAO detectam ato sexual e nunca devem ser tratadas como prova.
 * Elas apenas acumulam indicios visuais que o motor temporal pode emitir como
 * `pose_compativel_sexual`:
 *
 * - mao/punho proximo da regiao genital por varios frames;
 * - pernas/joelhos afastados em relacao a largura do quadril;
 * - movimento ritmico (inversoes de direcao) do punho ao longo dos frames.
 *
 * O modulo e puro e deterministico: sem browser, sem modelo, sem inferencia. A
 * confianca e uma soma ponderada de regras atendidas, limitada a 1; o evento
 * resultante continua sendo "indicio", nao veredito.
 *
 * Fachada: implementação em `./regras-pose/*`.
 */

export type { RegraPoseSexual, ConfigRegrasPoseSexual, ResultadoRegraPose } from "./regras-pose/tipos";
export { CONFIG_REGRAS_POSE_SEXUAL_PADRAO } from "./regras-pose/tipos";
export { AvaliadorPoseSexual } from "./regras-pose/avaliador";
