import type { DiagnosticoSinalTemporal, EstadoDedos } from "../../../src/domain";
import { RastreadorObjetos } from "../../../src/rastreamento";
import { DetectorMudancaDeCena } from "../../../src/cena";
import type {
  ConfigMotorTemporal,
  ConfiguracaoParcialMotorTemporal,
} from "../contracts";
import { CONFIG_MOTOR_TEMPORAL_PADRAO } from "../contracts";
import { RastreadorEntidades } from "../rastreador-entidades";
import { MaquinaSinais } from "../maquina-sinais";
import { AvaliadorPoseSexual } from "../regras-pose";
import { DetectorInteracao } from "../interacao";
import { DetectorPresencaPessoas } from "../presenca-pessoas";

export class MotorTemporalBase {
  protected readonly config: ConfigMotorTemporal;
  protected readonly objetos: RastreadorObjetos;
  protected readonly cena: DetectorMudancaDeCena;
  protected readonly pessoas: RastreadorEntidades;
  protected readonly maos: RastreadorEntidades;
  protected readonly gestos: MaquinaSinais;
  protected readonly braco: MaquinaSinais;
  protected readonly transicao: MaquinaSinais;
  protected readonly movimento: MaquinaSinais;
  protected readonly poseSexual: MaquinaSinais;
  /** Regras geometricas de pose compativel (Fase 7.2). */
  protected readonly avaliadorPose: AvaliadorPoseSexual;
  /** Interacoes mao-objeto com grau de evidencia explicito (Fase 4). */
  protected readonly interacoes: DetectorInteracao;
  /** Entrada/saida de pessoas pelo track de pose (Fase 4). */
  protected readonly presencas: DetectorPresencaPessoas;
  /** Histerese dos cinco dedos por track de mao. */
  protected readonly dedosPorEntidade = new Map<string, EstadoDedos>();
  /** Ultima amostra vertical de cada punho por pessoa/lado, para transicao. */
  protected readonly punhos = new Map<string, { y: number; tempoMs: number }>();
  /** Diagnostico mais recente por sinal+entidade (estado corrente do ciclo). */
  protected readonly diagnosticos = new Map<string, DiagnosticoSinalTemporal>();
  protected ultimoTempoMs: number | null = null;

  constructor(config?: ConfiguracaoParcialMotorTemporal) {
    this.config = {
      ...CONFIG_MOTOR_TEMPORAL_PADRAO,
      ...config,
      rastreador: { ...CONFIG_MOTOR_TEMPORAL_PADRAO.rastreador, ...config?.rastreador },
      gestos: { ...CONFIG_MOTOR_TEMPORAL_PADRAO.gestos, ...config?.gestos },
      braco: { ...CONFIG_MOTOR_TEMPORAL_PADRAO.braco, ...config?.braco },
      transicao: { ...CONFIG_MOTOR_TEMPORAL_PADRAO.transicao, ...config?.transicao },
      movimento: { ...CONFIG_MOTOR_TEMPORAL_PADRAO.movimento, ...config?.movimento },
      poseSexual: { ...CONFIG_MOTOR_TEMPORAL_PADRAO.poseSexual, ...config?.poseSexual },
      regrasPoseSexual: {
        ...CONFIG_MOTOR_TEMPORAL_PADRAO.regrasPoseSexual,
        ...config?.regrasPoseSexual,
      },
      interacao: { ...CONFIG_MOTOR_TEMPORAL_PADRAO.interacao, ...config?.interacao },
      presenca: { ...CONFIG_MOTOR_TEMPORAL_PADRAO.presenca, ...config?.presenca },
    };
    this.objetos = new RastreadorObjetos();
    this.cena = new DetectorMudancaDeCena();
    this.pessoas = new RastreadorEntidades(this.config.rastreador, "pes");
    this.maos = new RastreadorEntidades(this.config.rastreador, "mao");
    this.gestos = new MaquinaSinais(this.config.gestos);
    this.braco = new MaquinaSinais(this.config.braco);
    this.transicao = new MaquinaSinais(this.config.transicao);
    this.movimento = new MaquinaSinais(this.config.movimento);
    this.poseSexual = new MaquinaSinais(this.config.poseSexual);
    this.avaliadorPose = new AvaliadorPoseSexual(this.config.regrasPoseSexual);
    this.interacoes = new DetectorInteracao(this.config.interacao);
    this.presencas = new DetectorPresencaPessoas(this.config.presenca);
  }

  /** Reseta todo o estado (evento explicito de sessao). */
  resetar(): void {
    this.objetos.reiniciar();
    this.cena.reiniciar();
    this.pessoas.limpar();
    this.maos.limpar();
    this.gestos.limpar();
    this.braco.limpar();
    this.transicao.limpar();
    this.movimento.limpar();
    this.poseSexual.limpar();
    this.avaliadorPose.limpar();
    this.interacoes.limpar();
    this.presencas.limpar();
    this.dedosPorEntidade.clear();
    this.punhos.clear();
    this.diagnosticos.clear();
    this.ultimoTempoMs = null;
  }

  /** Entidades vivas de pose (exposto para observabilidade/testes). */
  get pessoasVivas() {
    return this.pessoas.vivas;
  }

  /** Entidades vivas de maos (exposto para observabilidade/testes). */
  get maosVivas() {
    return this.maos.vivas;
  }
}
