export function planejar(config) {
    const passoMs = config.tickMs * config.acelerar;
    const passos = Math.ceil(config.duracaoMs / config.tickMs);
    const duracaoSimuladaMs = passos * passoMs;

    // Janela de 3 ticks simulados (ou maior que o limiar), em tempo simulado.
    const janelaBrutaMs = Math.max(
      3 * passoMs,
      config.limiarLacunaMs + passoMs
    );
    const janelaMs = Math.min(janelaBrutaMs, Math.floor(0.19 * duracaoSimuladaMs));
    const lacunasInjetadas = [0.25, 0.55, 0.8].map((fração) => {
      const inicioMs = Math.round(duracaoSimuladaMs * fração);
      return { inicioMs, fimMs: inicioMs + janelaMs };
    });

    // Com acelerar > 1 o tick simulado cresce: escala a configuração da sessão
    // para que a cadência normal não seja classificada como lacuna.
    const duracaoSegmentoSessaoMs = config.duracaoSegmentoMs * config.acelerar;
    let limiarSessaoMs = Math.max(config.limiarLacunaMs * config.acelerar, passoMs);
    if (limiarSessaoMs >= janelaMs) limiarSessaoMs = Math.max(passoMs, janelaMs - passoMs);

    const notasDoHarness = [];
    if (config.acelerar > 1) {
      notasDoHarness.push(
        `Sessão com duracaoSegmentoMs=${duracaoSegmentoSessaoMs} e ` +
          `limiarLacunaMs=${limiarSessaoMs} (tempo simulado escalado por ${config.acelerar}x).`
      );
    }
  return {
    passoMs,
    passos,
    duracaoSimuladaMs,
    janelaMs,
    lacunasInjetadas,
    duracaoSegmentoSessaoMs,
    limiarSessaoMs,
    notasDoHarness,
  };
}
