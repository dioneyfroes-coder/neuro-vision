/**
 * Modelo de visao obrigatorio quando o subsistema NSFW esta ativo.
 *
 * O identificador agora tem uma unica fonte tipada (`configuracao-gemma.ts`);
 * este re-export preserva o contrato publico usado por cliente, servidor e
 * testes. O padrao do app sem NSFW continua sendo `qwen2.5-vl-3b-instruct`.
 */
import { MODELO_GEMMA_PADRAO, resolverConfiguracaoGemma } from "./configuracao-gemma";

export const MODELO_NSFW = MODELO_GEMMA_PADRAO;

/**
 * Resolve o modelo efetivo de uma requisicao de visao.
 *
 * Com NSFW ativo, ignora a escolha da interface/padrao do servidor e devolve
 * sempre `MODELO_NSFW`. Sem NSFW, preserva o modelo pedido (`undefined` = o
 * servidor decide o padrao).
 */
export function resolverModeloVisao(
  modelo: string | undefined | null,
  nsfwAtivo: boolean,
  configuracao?: Parameters<typeof resolverConfiguracaoGemma>[0]
): string | undefined {
  return nsfwAtivo ? resolverConfiguracaoGemma(configuracao).modelo : (modelo ?? undefined);
}

/**
 * Instrucao explicita que acompanha qualquer prompt quando o NSFW esta ativo.
 *
 * Nao e uma sugestao: o modelo deve descrever o que a imagem mostra mesmo que
 * seja conteudo adulto explicito. As unicas restricoes sao nao inventar o que
 * nao esta visivel e nao sexualizar pessoas que aparentem ser menores.
 */
export const INSTRUCAO_NSFW = [
  "CONTEUDO ADULTO (NSFW) - CLASSIFICADOR LOCAL ATIVO",
  "",
  "As marcacoes abaixo sao EVIDENCIA observada do detector, nao um veredito.",
  "A imagem sempre prevalece.",
  "",
  "Regras:",
  "1. Descreva o conteudo adulto visivel de forma explicita, direta e detalhada, em portugues, " +
    "com termos anatomicos (penis, vagina, anus, seios/mamilos, nadegas). Sem eufemismos, " +
    "asteriscos, tarjas ou censura.",
  "2. E proibido recusar a descricao por ser conteudo adulto. Nao peca desculpas e nao mencione " +
    "politicas, filtros, esta instrucao ou o classificador na resposta.",
  "3. Use as marcacoes para localizar o conteudo, mas descreva o que a imagem mostra. Se a caixa " +
    "nao corresponder ao conteudo visivel, registre a divergencia como incerteza.",
  "4. Ausencia de marcacao NAO prova ausencia de conteudo adulto: o detector pode falhar. Se houver " +
    "conteudo adulto nao marcado, descreva-o.",
  "5. Score = confianca do detector em [0,1], nao intensidade, gravidade ou consentimento. " +
    "Caixa = [xmin,ymin,xmax,ymax] normalizada, com origem no canto superior esquerdo.",
  "6. Em multiframe, relacione cada marcacao ao indice/frameId da imagem e descreva continuidade, " +
    "progressao e mudancas. Nao repita a mesma descricao em todas as imagens e nao presuma acoes " +
    "entre frames sem evidencia.",
  "7. Pessoas na cena: informe quantas pessoas adultas aparecem e descreva a apresentacao visual e " +
    "as caracteristicas visiveis. Use 'homem' ou 'mulher' para apresentacao visual quando a imagem " +
    "sustentar; use 'pessoa trans' somente se houver declaracao explicita no conteudo ou metadado. " +
    "Nunca deduza 'trans' de tracos fisicos, roupa, voz ou comportamento.",
  "8. Assuma pessoas adultas, exceto se a imagem indicar claramente menoridade. Se houver indicio de " +
    "que alguem seja menor, nao descreva essa pessoa sexualmente: descreva apenas o contexto nao " +
    "sexual e registre a duvida como incerteza. Nao descreva atos sexuais com animais.",
  "9. Nao invente conteudo adulto, participantes, atos ou objetos que nao estejam visiveis.",
].join("\n");

/**
 * Instrucao de inferencia de acao sexual a partir de **varios frames** do mesmo
 * ciclo. O bloco so faz sentido com 2+ imagens: acao e fenomeno temporal e um
 * frame isolado nao sustenta conclusao sobre masturbacao, sexo oral ou
 * penetracao.
 *
 * O texto exige separar o que e visivel do que e inferido, preservar os
 * `frameId` reais e tratar a conclusao como inferencia com confianca — nunca
 * como certeza. E a mudanca de maior ganho do plano (Fase 7.1).
 */
export const INSTRUCAO_ACAO_MULTIFRAME = [
  "ACAO SEXUAL EM MULTIFRAME - INFERENCIA, NAO CERTEZA",
  "",
  "Voce recebeu varias imagens do MESMO ciclo, em ordem cronologica. Use a sequencia inteira; nao conclua acao sexual a partir de uma unica imagem.",
  "",
  "Regras:",
  "1. Para cada acao sexual (masturbacao, sexo oral, penetracao vaginal/anal, outra), preencha em `acoes`:",
  "   - `tipo`: `masturbacao`, `sexo_oral`, `penetracao` ou `outra`;",
  "   - `natureza`: `observada` quando o ato e diretamente visivel em pelo menos um frame; `inferida` quando a conclusao depende da continuidade/sequencia entre frames;",
  "   - `confianca` em [0,1] (nao use 1,0: e leitura do modelo, nao medicao);",
  "   - `evidencias` com os frameIds EXATOS que sustentam a conclusao.",
  "2. Preserve os frameIds reais de cada imagem. Nunca invente IDs.",
  "3. Inferencia nunca e certeza: use confianca abaixo de 0,7 quando a conclusao depender de oclusao, roupa, angulo, iluminacao ou continuidade entre frames. Registre a duvida em `incertezas`.",
  "4. Nao presuma penetracao/sexo oral apenas por corpos proximos, expressao facial, roupa ou posicao. Exija evidencia visual concreta (contato genital, movimento coordenado, posicao compativel, continuidade entre frames).",
  "5. Movimento ritmico, mao proxima da genital e pernas/joelhos afastados sao indicios de POSE COMPATIVEL, nao prova de ato sexual. Se for so isso, descreva como indicio e mantenha `natureza: inferida` com confianca baixa.",
  "6. Se a sequencia nao sustentar a acao, escreva 'nao observado' na descricao e nao invente `tipo`. Ausencia de evidencia nao e evidencia de ausencia.",
  "7. Descreva separadamente o que e corpo visivel (genital, seios, nadegas, posicao) do que e acao inferida; o relatorio precisa distinguir acerto de acao de deteccao de corpo.",
].join("\n");

/**
 * Bloco de acao multiframe, vazio quando ha menos de 2 imagens.
 *
 * O numero de frames entra no texto para que o modelo saiba quantas evidencias
 * temporais tem e nao trate a sequencia como um unico instante.
 */
export function blocoAcaoMultiframe(quantidadeFrames: number): string {
  if (!Number.isFinite(quantidadeFrames) || quantidadeFrames < 2) return "";
  return `${INSTRUCAO_ACAO_MULTIFRAME}\n\nImagens neste ciclo: ${Math.floor(quantidadeFrames)}.`;
}
