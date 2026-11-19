/**
 * Composicao do servidor HTTP e tabela de rotas.
 *
 * Fachada: implementação dividida por responsabilidade em `./servidor/*`.
 */
export type { ServerConfig } from "./servidor/tipos";
export { createServer } from "./servidor/criar-servidor";
