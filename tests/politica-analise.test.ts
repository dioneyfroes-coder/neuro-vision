import { describe, expect, it } from "vitest";
import type { EntradaLog, EventoVisual } from "../src/types";
import {
  CONFIG_POLITICA_PADRAO,
  PoliticaAnalise,
  configurarPolitica,
  rotuloMotivo,
  comMotivo,
} from "../src/politica-analise";
import type { MotivoAnalise } from "../src/types";

function evento(tipo: EventoVisual["tipo"]): EventoVisual {
  return {
    id: `e-${tipo}`,
    timestamp: new Date(0).toISOString(),
    tipo,
    descricao: tipo,
    origem: "rastreador",
  };
}

function entrada(parcial: {
  agora?: number;
  eventos?: EventoVisual[];
  melhorConfianca?: number | null;
  percepcaoValida?: boolean;
  manual?: boolean;
}) {
  return {
    agora: parcial.agora ?? 100_000,
    eventos: parcial.eventos ?? [],
    melhorConfianca: parcial.melhorConfianca ?? null,
    percepcaoValida: parcial.percepcaoValida ?? true,
    manual: parcial.manual,
  };
}

describe("PoliticaAnalise", () => {
  it("aciona a primeira analise quando nunca houve chamada", () => {
    const politica = new PoliticaAnalise();
    const avaliacao = politica.avaliar(entrada({}));
    expect(avaliacao).toEqual({ acionar: true, motivo: "primeira_analise" });
  });

  it("nao aciona dentro do cooldown, mesmo com evento critico", () => {
    const politica = new PoliticaAnalise();
    politica.registrarChamada(100_000);
    const avaliacao = politica.avaliar(
      entrada({ eventos: [evento("aparicao")], agora: 100_000 + 5_000 })
    );
    expect(avaliacao.acionar).toBe(false);
    expect(avaliacao.motivo).toBe("sem_acao");
  });

  it("aciona por nova entidade depois do cooldown", () => {
    const politica = new PoliticaAnalise();
    politica.registrarChamada(100_000);
    const avaliacao = politica.avaliar(
      entrada({ eventos: [evento("aparicao")], agora: 100_000 + CONFIG_POLITICA_PADRAO.cooldownMs })
    );
    expect(avaliacao).toEqual({ acionar: true, motivo: "nova_entidade" });
  });

  it("considera desaparecimento e mudanca de cena criticos", () => {
    const politica = new PoliticaAnalise();
    politica.registrarChamada(100_000);
    expect(
      politica.avaliar(
        entrada({ eventos: [evento("desaparecimento")], agora: 100_000 + 10_000 })
      ).motivo
    ).toBe("desaparecimento");
    expect(
      politica.avaliar(
        entrada({ eventos: [evento("mudanca_de_cena")], agora: 100_000 + 20_000 })
      ).motivo
    ).toBe("mudanca_de_cena");
  });

  it("trata movimento abaixo do minimo como sem mudanca relevante", () => {
    const politica = new PoliticaAnalise(configurarPolitica({ movimentoMinimo: 2 }));
    politica.registrarChamada(100_000);
    expect(
      politica.avaliar(
        entrada({ eventos: [evento("movimento")], agora: 100_000 + 10_000 })
      ).motivo
    ).toBe("sem_acao");
    expect(
      politica.avaliar(
        entrada({ eventos: [evento("movimento"), evento("movimento")], agora: 100_000 + 20_000 })
      ).motivo
    ).toBe("movimento");
  });

  it("aciona por baixa confianca quando ha deteccao duvidosa", () => {
    const politica = new PoliticaAnalise();
    politica.registrarChamada(100_000);
    const avaliacao = politica.avaliar(
      entrada({ melhorConfianca: 0.5, agora: 100_000 + 10_000 })
    );
    expect(avaliacao).toEqual({ acionar: true, motivo: "baixa_confianca" });
  });

  it("nao aciona por baixa confianca quando a deteccao e solida", () => {
    const politica = new PoliticaAnalise();
    politica.registrarChamada(100_000);
    const avaliacao = politica.avaliar(
      entrada({ melhorConfianca: 0.9, agora: 100_000 + 10_000 })
    );
    expect(avaliacao.acionar).toBe(false);
  });

  it("aciona resumo periodico quando nada mudou apos o intervalo", () => {
    const politica = new PoliticaAnalise(configurarPolitica({ resumoPeriodicoMs: 30_000 }));
    politica.registrarChamada(100_000);
    const avaliacao = politica.avaliar(entrada({ agora: 100_000 + 30_000 }));
    expect(avaliacao).toEqual({ acionar: true, motivo: "resumo_periodico" });
  });

  it("limita o numero de chamadas na janela mesmo com eventos criticos", () => {
    const politica = new PoliticaAnalise(configurarPolitica({ maxChamadasPorJanela: 1, cooldownMs: 0 }));
    politica.registrarChamada(100_000);
    expect(politica.avaliar(entrada({ eventos: [evento("aparicao")] })).acionar).toBe(false);
  });

  it("manual ignora cooldown e janela", () => {
    const politica = new PoliticaAnalise(configurarPolitica({ maxChamadasPorJanela: 0 }));
    politica.registrarChamada(100_000);
    const avaliacao = politica.avaliar(entrada({ manual: true, agora: 150_000 }));
    expect(avaliacao).toEqual({ acionar: true, motivo: "manual" });
  });

  it("falha da percepcao aciona o Ollama apos cooldown (nunca vira ausencia de mudanca)", () => {
    const politica = new PoliticaAnalise(configurarPolitica({ cooldownMs: 60_000 }));
    politica.registrarChamada(100_000);
    // Dentro do cooldown: nao aciona.
    expect(
      politica.avaliar(entrada({ percepcaoValida: false, agora: 100_000 + 1_000 })).acionar
    ).toBe(false);
    // Apos o cooldown: aciona com motivo de falha.
    const avaliacao = politica.avaliar(
      entrada({ percepcaoValida: false, agora: 100_000 + 61_000 })
    );
    expect(avaliacao).toEqual({ acionar: true, motivo: "falha_percepcao" });
  });

  it("falhas consecutivas de percepcao respeitam cooldown e contam na janela", () => {
    const politica = new PoliticaAnalise(
      configurarPolitica({ cooldownMs: 5_000, janelaMs: 30_000, maxChamadasPorJanela: 2 })
    );
    // Primeira falha: aciona.
    expect(
      politica.avaliar(entrada({ percepcaoValida: false, agora: 100_000 })).motivo
    ).toBe("falha_percepcao");
    politica.registrarChamada(100_000);
    // Segunda falha dentro do cooldown: bloqueada.
    const bloqueada = politica.avaliar(entrada({ percepcaoValida: false, agora: 100_000 + 1_000 }));
    expect(bloqueada).toEqual({ acionar: false, motivo: "sem_acao" });
    // Sequencia de falhas apos o cooldown esgota a janela.
    politica.registrarChamada(100_000 + 6_000);
    const esgotada = politica.avaliar(entrada({ percepcaoValida: false, agora: 100_000 + 12_000 }));
    expect(esgotada).toEqual({ acionar: false, motivo: "sem_acao" });
    // Apos a janela deslizante, uma nova falha pode acionar de novo.
    const renovada = politica.avaliar(entrada({ percepcaoValida: false, agora: 100_000 + 31_000 }));
    expect(renovada.motivo).toBe("falha_percepcao");
  });

  it("manual aciona mesmo com falha de percepcao (excecao documentada)", () => {
    const politica = new PoliticaAnalise(configurarPolitica({ cooldownMs: 60_000, maxChamadasPorJanela: 0 }));
    politica.registrarChamada(100_000);
    const avaliacao = politica.avaliar(
      entrada({ percepcaoValida: false, manual: true, agora: 100_000 + 1_000 })
    );
    expect(avaliacao).toEqual({ acionar: true, motivo: "manual" });
  });

  it("respeita a janela deslizante apos o intervalo", () => {
    const politica = new PoliticaAnalise(
      configurarPolitica({ maxChamadasPorJanela: 1, janelaMs: 10_000, cooldownMs: 0, resumoPeriodicoMs: 0 })
    );
    politica.registrarChamada(100_000);
    expect(
      politica.avaliar(entrada({ eventos: [evento("aparicao")], agora: 100_000 + 1 })).acionar
    ).toBe(false);
    expect(
      politica.avaliar(entrada({ eventos: [evento("aparicao")], agora: 100_000 + 11_000 })).acionar
    ).toBe(true);
  });

  it("gera rotulo em portugues para todos os motivos", () => {
    const motivos: MotivoAnalise[] = [
      "primeira_analise",
      "mudanca_de_cena",
      "nova_entidade",
      "desaparecimento",
      "movimento",
      "baixa_confianca",
      "resumo_periodico",
      "manual",
      "falha_percepcao",
    ];
    for (const motivo of motivos) {
      expect(rotuloMotivo(motivo).length).toBeGreaterThan(0);
    }
  });

  it("comMotivo adiciona o motivo somente quando informado", () => {
    const base: EntradaLog = {
      timestamp: "t",
      modelo: "m",
      objetos: [],
      resumo: "x",
      tipo: "descricao",
    };
    const com = comMotivo({ ...base }, "nova_entidade");
    expect(com.motivo).toBe("nova_entidade");
    expect(comMotivo({ ...base }, undefined).motivo).toBeUndefined();
  });
});