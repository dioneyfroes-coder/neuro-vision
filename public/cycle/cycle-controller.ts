/**
 * Controlador do ciclo (Etapa 2 do roteiro de modularizacao).
 *
 * Concentra a logica de negocio do ciclo de frame unico — captura, inferencia,
 * atualizacao temporal, persistencia e progresso — a partir de dependencias
 * **injetadas** (camera, motores, rastreador, politica, fila de persistencia).
 * A interface (`public/app.ts`) fica com a ligacao de botoes/seletores e a
 * renderizacao do progresso, recebendo `EventoUi` de volta.
 */

export type {
  CameraCaptura,
  ControladorCiclo,
  DependenciasCiclo,
  EventoUi,
  ItemHistorico,
  RepositorioCliente,
} from "./cycle-controller/tipos";
export { CycleController } from "./cycle-controller/analise";
