/**
 * Confere se todas as variantes rodaram com a MESMA versao do modelo
 * multimodal, usando SOMENTE `logs/visao.jsonl` (entradas do multimodal ligadas
 * aos ciclos pelo frameId). O campo `modelo` dos eventos e o detector local e
 * nao serve para essa prova. `consistente` e falso se houver qualquer aviso.
 */
export function verificarMesmoModelo(resultados, modeloGlobal) {
  const porVariante = resultados.map(({ variante, modelos }) => ({
    letra: variante.letra,
    modelos: [...new Set(modelos?.visao ?? [])].sort(),
  }));
  const todos = [...new Set(porVariante.flatMap((p) => p.modelos))].sort();
  const avisos = [];
  const comDados = porVariante.filter((p) => p.modelos.length);

  if (comDados.length >= 2) {
    const divergentes = comDados.filter((p) => p.modelos.join("|") !== comDados[0].modelos.join("|"));
    if (divergentes.length) {
      avisos.push(
        `modelos divergentes entre variantes: ${comDados
          .map((p) => `${p.letra}=[${p.modelos.join(", ")}]`)
          .join(" vs ")} — todas as variantes devem rodar com o mesmo modelo`
      );
    }
  }
  if (modeloGlobal) {
    const esperado = modeloGlobal.trim().toLowerCase();
    for (const p of comDados) {
      const fora = p.modelos.filter((m) => m.toLowerCase() !== esperado);
      if (fora.length) {
        avisos.push(
          `variante ${p.letra} registrou modelo diferente do --modelo: [${fora.join(", ")}] vs "${modeloGlobal}"`
        );
      }
    }
  }
  if (!todos.length) {
    avisos.push(
      "nao foi possivel verificar a versao do modelo multimodal (sem campo `modelo` em visao.jsonl para os frames dos ciclos); confirme manualmente que todas as variantes usaram o mesmo modelo"
    );
  }
  return { consistente: avisos.length === 0, modelos: todos, porVariante, avisos };
}
