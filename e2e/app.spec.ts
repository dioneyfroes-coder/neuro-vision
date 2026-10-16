import { expect, test, type Page } from "@playwright/test";

const CDN_TRANSFORMERS = /cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers/;

const STUB_TRANSFORMERS = `
export const env = {};
export async function pipeline() {
  return async () => [];
}
`;

const FALHA_TRANSFORMERS = `
export const env = {};
export async function pipeline() {
  throw new Error("modelo indisponivel");
}
`;

// Simula WebGPU indisponivel: a carga em WebGPU falha e o detector cai para
// WASM (CPU). O aviso persistente de fallback deve aparecer.
const FALHA_WEBGPU_TRANSFORMERS = `
export const env = {};
export async function pipeline(_tarefa, _modelo, opcoes) {
  if (opcoes && opcoes.device === "webgpu") {
    throw new Error("WebGPU indisponivel");
  }
  return async () => [];
}
`;

const DETECTOR_LENTO = `
export const env = {};
export async function pipeline() {
  return async () => {
    const w = window;
    w.__deteccoes = (w.__deteccoes || 0) + 1;
    if (w.__emExecucao) w.__sobreposicoes = (w.__sobreposicoes || 0) + 1;
    w.__emExecucao = true;
    w.__inicios = w.__inicios || [];
    w.__inicios.push(Date.now());
    await new Promise((resolve) => setTimeout(resolve, 2500));
    w.__emExecucao = false;
    return [];
  };
}
`;

const ENTRADAS = [
  {
    timestamp: "2026-10-10T12:00:05.000Z",
    modelo: "qwen2.5-vl-3b-instruct",
    objetos: [],
    resumo: "Uma pessoa no escritorio.",
    tipo: "descricao",
  },
  {
    timestamp: "2026-10-10T12:00:00.000Z",
    modelo: "Xenova/yolos-tiny",
    objetos: [
      { nome: "pessoa", rotulo: "person", score: 0.9, caixa: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 } },
    ],
    resumo: "pessoa",
    tipo: "deteccao",
  },
];

async function prepararPagina(page: Page, transformersBody = STUB_TRANSFORMERS): Promise<void> {
  await page.route(CDN_TRANSFORMERS, (rota) =>
    rota.fulfill({ status: 200, contentType: "text/javascript", body: transformersBody })
  );
  await page.route("**/api/health", (rota) =>
    rota.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        visao: {
          online: false,
          modelo: "qwen2.5-vl-3b-instruct",
          modelos: [],
          carregados: [],
          erro: "desligado",
        },
      }),
    })
  );
  await page.route("**/api/logs**", (rota) => {
    if (rota.request().method() === "GET") {
      return rota.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, total: ENTRADAS.length, entradas: ENTRADAS }),
      });
    }
    return rota.continue();
  });
}

async function instalarCameraFalsa(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      (window as unknown as { __testStream: MediaStream }).__testStream = stream;
      return stream;
    };
  });
}

test("carrega o historico persistido", async ({ page }) => {
  await prepararPagina(page);
  await page.goto("/");

  await expect(page.locator("#log li")).toHaveCount(2);
  await expect(page.locator("#logCount")).toHaveText("2");
  await expect(page.locator("#log")).toContainText("Uma pessoa no escritorio.");
  await expect(page.locator("#log")).toContainText("pessoa 90%");
});

test("filtra as entradas do historico", async ({ page }) => {
  await prepararPagina(page);
  await page.goto("/");
  await expect(page.locator("#log li")).toHaveCount(2);

  await page.locator("#filter").fill("yolos");
  await expect(page.locator("#log li", { hasText: "yolos-tiny" })).toBeVisible();
  await expect(page.locator("#log li", { hasText: "qwen2.5-vl" })).toBeHidden();
});

test("limpar o historico zera a lista e apaga no servidor", async ({ page }) => {
  const chamadas: string[] = [];
  await prepararPagina(page);
  await page.route("**/api/logs", (rota) => {
    if (rota.request().method() === "DELETE") {
      chamadas.push("DELETE");
      return rota.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, snapshots: 0 }),
      });
    }
    return rota.continue();
  });

  await page.goto("/");
  await expect(page.locator("#log li")).toHaveCount(2);
  await expect(page.locator("#clearLog")).toBeEnabled();

  await page.locator("#clearLog").click();

  await expect(page.locator("#status")).toContainText("Historico limpo");
  await expect(page.locator("#log li")).toHaveCount(0);
  await expect(page.locator("#logCount")).toHaveText("0");
  await expect(page.locator("#clearLog")).toBeDisabled();
  expect(chamadas).toEqual(["DELETE"]);
});

test("exibe o status do backend de visao", async ({ page }) => {
  await prepararPagina(page);
  await page.goto("/");
  await expect(page.locator("#modeloStatus")).toContainText("offline");
});

test("reabilita o Iniciar quando o acesso a webcam falha", async ({ page }) => {
  await prepararPagina(page);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new Error("Permissao negada");
    };
  });
  await page.goto("/");
  await page.locator("#start").click();

  await expect(page.locator("#status")).toContainText("webcam");
  await expect(page.locator("#start")).toBeEnabled();
  await expect(page.locator("#stop")).toBeDisabled();
  await expect(page.locator("#placeholder")).toBeVisible();
});

test("libera a webcam quando o modelo de deteccao falha ao carregar", async ({ page }) => {
  await prepararPagina(page, FALHA_TRANSFORMERS);
  await instalarCameraFalsa(page);
  await page.goto("/");
  await page.locator("#motor").selectOption("deteccao");
  await page.locator("#start").click();

  await expect(page.locator("#status")).toContainText("Falha ao carregar modelo");
  await expect(page.locator("#start")).toBeEnabled();
  await expect(page.locator("#stop")).toBeDisabled();
  await expect(page.locator("#placeholder")).toBeVisible();

  const estado = await page.evaluate(
    () => (window as unknown as { __testStream: MediaStream }).__testStream.getTracks()[0].readyState
  );
  expect(estado).toBe("ended");
});

test("libera a webcam quando a preparacao da visao falha", async ({ page }) => {
  await prepararPagina(page);
  await page.route("**/api/visao/preparar", (rota) =>
    rota.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, erro: "modelo indisponivel" }),
    })
  );
  await instalarCameraFalsa(page);
  await page.goto("/");
  await page.locator("#motor").selectOption("visao");
  await page.locator("#start").click();

  await expect(page.locator("#status")).toContainText("Falha ao preparar o modelo de visao");
  await expect(page.locator("#start")).toBeEnabled();
  await expect(page.locator("#stop")).toBeDisabled();
  await expect(page.locator("#placeholder")).toBeVisible();

  const estado = await page.evaluate(
    () => (window as unknown as { __testStream: MediaStream }).__testStream.getTracks()[0].readyState
  );
  expect(estado).toBe("ended");
});

test("bloqueia trocar motor/modelo durante a execucao e libera ao parar", async ({ page }) => {
  await prepararPagina(page, DETECTOR_LENTO);
  await instalarCameraFalsa(page);
  await page.goto("/");
  await page.locator("#motor").selectOption("deteccao");
  await expect(page.locator("#motor")).toBeEnabled();
  await expect(page.locator("#model")).toBeEnabled();
  await expect(page.locator("#modeloVisao")).toBeEnabled();

  await page.locator("#start").click();
  await page.waitForFunction(
    () => ((window as unknown as { __deteccoes?: number }).__deteccoes ?? 0) >= 1,
    undefined,
    { timeout: 15_000 }
  );
  await expect(page.locator("#motor")).toBeDisabled();
  await expect(page.locator("#model")).toBeDisabled();
  await expect(page.locator("#modeloVisao")).toBeDisabled();

  await page.locator("#stop").click();
  await expect(page.locator("#motor")).toBeEnabled();
  await expect(page.locator("#model")).toBeEnabled();
  await expect(page.locator("#modeloVisao")).toBeEnabled();
});

test("escolhe o modelo de visao na interface e o envia ao servidor", async ({ page }) => {
  const modelos = ["qwen2.5-vl-3b-instruct", "gemma-4-e2b-uncensored-hauhaucs-aggressive"];
  const embedding = "text-embedding-nomic-embed-text-v1.5";
  await prepararPagina(page);
  await page.route("**/api/health", (rota) =>
    rota.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        visao: {
          online: true,
          solicitado: modelos[0],
          modelo: modelos[0],
          modelos: [...modelos, embedding],
          carregados: [modelos[0]],
          erro: "",
        },
      }),
    })
  );

  const preparos: string[] = [];
  await page.route("**/api/visao/preparar**", (rota) => {
    preparos.push(rota.request().url());
    return rota.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, modelo: modelos[1], carregado: true, carregandoMs: 10 }),
    });
  });

  const payloads: { modelo?: string }[] = [];
  await page.route("**/api/visao", (rota) => {
    payloads.push(rota.request().postDataJSON() as { modelo?: string });
    const ndjson =
      JSON.stringify({
        type: "done",
        descricao: "Mesa e cadeira.",
        modelo: modelos[1],
        tokens: 4,
        ms: 10,
        tipo: "descricao",
        semMudanca: false,
      }) + "\n";
    return rota.fulfill({ status: 200, contentType: "application/x-ndjson", body: ndjson });
  });

  await instalarCameraFalsa(page);
  await page.goto("/");

  // O seletor lista os modelos instalados de visao (+ "Padrão do servidor") e
  // deixa de fora modelos de embedding, que nunca respondem a visao.
  await expect(page.locator("#modeloVisao option")).toHaveCount(modelos.length + 1);
  await expect(page.locator(`#modeloVisao option[value="${embedding}"]`)).toHaveCount(0);

  await page.locator("#modeloVisao").selectOption(modelos[1]);
  await page.locator("#motor").selectOption("visao");
  await page.locator("#start").click();

  await expect(page.locator("#status")).toContainText("Mesa e cadeira.", { timeout: 15_000 });

  // O preparo pediu o modelo escolhido e a analise o levou no payload.
  expect(preparos.some((u) => u.includes(`modelo=${modelos[1]}`))).toBe(true);
  expect(payloads.at(-1)?.modelo).toBe(modelos[1]);

  await page.locator("#stop").click();
  await expect(page.locator("#start")).toBeEnabled();
});

test("parar durante a inferencia libera a webcam e permite iniciar de novo", async ({ page }) => {
  await prepararPagina(page, DETECTOR_LENTO);
  await instalarCameraFalsa(page);
  await page.goto("/");
  await page.locator("#motor").selectOption("deteccao");
  await page.locator("#start").click();

  await page.waitForFunction(
    () => ((window as unknown as { __deteccoes?: number }).__deteccoes ?? 0) >= 1,
    undefined,
    { timeout: 15_000 }
  );
  await expect(page.locator("#stop")).toBeEnabled();
  await page.locator("#stop").click();

  await expect(page.locator("#start")).toBeEnabled();
  await expect(page.locator("#stop")).toBeDisabled();
  const parada = await page.evaluate(
    () => (window as unknown as { __testStream: MediaStream }).__testStream.getTracks()[0].readyState
  );
  expect(parada).toBe("ended");

  await page.locator("#start").click();
  await page.waitForFunction(
    () => ((window as unknown as { __deteccoes?: number }).__deteccoes ?? 0) >= 2,
    undefined,
    { timeout: 15_000 }
  );
  await expect(page.locator("#stop")).toBeEnabled();
  await page.locator("#stop").click();
  await expect(page.locator("#start")).toBeEnabled();
});

test("inferencia lenta nao sobrepoe analises mesmo com intervalo curto", async ({ page }) => {
  await prepararPagina(page, DETECTOR_LENTO);
  await instalarCameraFalsa(page);
  await page.goto("/");
  await page.locator("#motor").selectOption("deteccao");
  await page.locator("#interval").evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = "1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#start").click();

  await page.waitForFunction(
    () => ((window as unknown as { __deteccoes?: number }).__deteccoes ?? 0) >= 3,
    undefined,
    { timeout: 25_000 }
  );

  const resultado = await page.evaluate(() => {
    const w = window as unknown as { __sobreposicoes?: number; __inicios?: number[] };
    return { sobreposicoes: w.__sobreposicoes ?? 0, inicios: w.__inicios ?? [] };
  });

  expect(resultado.sobreposicoes).toBe(0);
  for (let i = 1; i < resultado.inicios.length; i++) {
    // Cada ciclo so comeca apos a inferencia anterior (2,5s) terminar.
    expect(resultado.inicios[i] - resultado.inicios[i - 1]).toBeGreaterThanOrEqual(2500);
  }

  await page.locator("#stop").click();
  await expect(page.locator("#start")).toBeEnabled();
});

test("o snapshot do historico e o frame analisado, com o instante da captura", async ({ page }) => {
  await prepararPagina(page);
  await instalarCameraFalsa(page);
  await page.goto("/");
  await page.locator("#motor").selectOption("deteccao");

  const pedido = page.waitForRequest(
    (req) => req.method() === "POST" && new URL(req.url()).pathname === "/api/log"
  );
  await page.locator("#start").click();

  const requisicao = await pedido;
  const corpo = requisicao.postDataJSON() as {
    capturadoEm?: string;
    timestamp: string;
    snapshot?: string;
  };
  expect(corpo.capturadoEm).toBeTruthy();
  expect(corpo.snapshot).toMatch(/^data:image\/jpeg/);
  expect(Date.parse(corpo.capturadoEm!)).toBeLessThanOrEqual(Date.parse(corpo.timestamp));

  // A entrada na tela usa o horario da captura do frame como horario principal.
  await expect(page.locator("#log li").first().locator(".time")).toHaveAttribute(
    "title",
    /Frame capturado às/
  );
  await page.locator("#stop").click();
  await expect(page.locator("#start")).toBeEnabled();
});

test("modo eventos aciona a visao pela politica e pelo botao manual", async ({ page }) => {
  const ndjson =
    [
      JSON.stringify({ type: "chunk", response: "Pessoa " }),
      JSON.stringify({
        type: "done",
        descricao: "Pessoa na sala.",
        modelo: "qwen2.5-vl-3b-instruct",
        tokens: 6,
        ms: 40,
        tipo: "descricao",
        semMudanca: false,
      }),
    ].join("\n") + "\n";

  await prepararPagina(page);
  await page.route("**/api/visao", (rota) =>
    rota.fulfill({ status: 200, contentType: "application/x-ndjson", body: ndjson })
  );
  await instalarCameraFalsa(page);
  await page.goto("/");
  await page.locator("#motor").selectOption("eventos");
  await expect(page.locator("#analisarAgora")).toBeDisabled();
  await page.locator("#start").click();

  // A politica aciona a primeira analise apos o primeiro tick (percepcao leve).
  await expect(page.locator("#status")).toContainText("LM Studio viu: Pessoa na sala.", {
    timeout: 20_000,
  });
  await expect(page.locator("#analisarAgora")).toBeEnabled();

  // O botao manual ignora o cooldown e dispara outra analise imediatamente.
  await page.locator("#analisarAgora").click();
  await page.waitForFunction(
    () => {
      const itens = Array.from(document.querySelectorAll("#log li"));
      return itens.filter((li) => li.textContent?.includes("Pessoa na sala.")).length >= 2;
    },
    undefined,
    { timeout: 10_000 }
  );

  await page.locator("#stop").click();
  await expect(page.locator("#start")).toBeEnabled();
});

test("rede offline nao quebra a pagina e a deteccao falha com mensagem clara", async ({
  page,
}) => {
  await prepararPagina(page);
  // CDN inacessivel (sem rede): a dependencia do Transformers.js agora e sob
  // demanda, entao apenas os modos de deteccao/eventos sao afetados.
  await page.route(CDN_TRANSFORMERS, (rota) => rota.abort("failed"));
  await instalarCameraFalsa(page);
  await page.goto("/");

  // A pagina carrega normalmente (historico + controles + status da visao).
  await expect(page.locator("#start")).toBeEnabled();
  await expect(page.locator("#log li")).toHaveCount(2);

  // A deteccao falha com mensagem clara, libera a webcam e devolve a UI.
  await page.locator("#motor").selectOption("deteccao");
  await page.locator("#start").click();
  await expect(page.locator("#status")).toContainText("Falha ao carregar modelo");
  await expect(page.locator("#start")).toBeEnabled();
  await expect(page.locator("#stop")).toBeDisabled();

  const estado = await page.evaluate(
    () => (window as unknown as { __testStream: MediaStream }).__testStream.getTracks()[0].readyState
  );
  expect(estado).toBe("ended");
});

test("mostra no diagnostico o motor, o modelo e o backend carregado", async ({ page }) => {
  await prepararPagina(page, DETECTOR_LENTO);
  // Sobrescreve o health padrao (offline) para exercitar a linha de diagnostico.
  await page.route("**/api/health", (rota) =>
    rota.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        visao: {
          online: true,
          modelo: "qwen2.5-vl-3b-instruct",
          modelos: ["qwen2.5-vl-3b-instruct"],
          carregados: ["qwen2.5-vl-3b-instruct"],
          erro: "",
        },
      }),
    })
  );
  await instalarCameraFalsa(page);
  await page.goto("/");

  const diag = page.locator("#diagInfo");
  await expect(diag).toContainText("motor parado");
  await expect(diag).toContainText("qwen2.5-vl-3b-instruct");

  // No motor de deteccao o modelo solicitado passa a ser o do navegador e a
  // inferencia medida entra no diagnostico (separada da carga e da persistencia).
  await page.locator("#motor").selectOption("deteccao");
  await expect(diag).toContainText("Xenova/yolos-tiny");
  await page.locator("#start").click();
  await expect(diag).toContainText("motor deteccao");
  await expect(diag).toContainText("inferencia", { timeout: 15_000 });
  await page.locator("#stop").click();
});

test("avisa quando a deteccao cai para CPU ao falhar o WebGPU", async ({ page }) => {
  await prepararPagina(page, FALHA_WEBGPU_TRANSFORMERS);
  await instalarCameraFalsa(page);
  await page.goto("/");

  await expect(page.locator("#gpuWarning")).toBeHidden();
  await page.locator("#motor").selectOption("deteccao");
  await page.locator("#start").click();

  await expect(page.locator("#gpuWarning")).toBeVisible();
  await expect(page.locator("#gpuWarning")).toContainText("CPU");
  await page.locator("#stop").click();
});
