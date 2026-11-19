export function criarCliente() {
  let errosHttp = 0;

    async function buscar(url, opcoes = {}) {
      const metodo = opcoes.method ?? "GET";
      try {
        const resposta = await fetch(url, {
          ...opcoes,
          signal: AbortSignal.timeout(10_000),
        });
        const texto = await resposta.text();
        let corpo = null;
        if (texto) {
          try {
            corpo = JSON.parse(texto);
          } catch {
            corpo = texto;
          }
        }
        if (!resposta.ok) {
          errosHttp += 1;
          console.error(`[soak] ${metodo} ${url} -> HTTP ${resposta.status}`);
        }
        return { ok: resposta.ok, status: resposta.status, corpo };
      } catch (erro) {
        errosHttp += 1;
        console.error(`[soak] ${metodo} ${url} -> ${erro instanceof Error ? erro.message : erro}`);
        return { ok: false, status: 0, corpo: null };
      }
    }

  return {
    buscar,
    get errosHttp() {
      return errosHttp;
    },
  };
}
