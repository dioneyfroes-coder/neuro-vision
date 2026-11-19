import { expect, test } from "@playwright/test";
import { prepararPagina, instalarCameraFalsa, ORT_LENTO } from "./helpers/app-fixtures";

test("exibe o status do backend de visao", async ({ page }) => {
  await prepararPagina(page);
  await page.goto("/");
  await expect(page.locator("#modeloStatus")).toContainText("offline");
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

test("explica quando o seletor de visao nao tem modelos", async ({ page }) => {
  await prepararPagina(page);
  await page.goto("/");

  const seletor = page.locator("#modeloVisao");
  await expect(seletor.locator("option")).toHaveCount(2);
  await expect(seletor.locator("option[disabled]")).toContainText("Backend offline");
  await expect(seletor.locator("option[disabled]")).toContainText("http://localhost:1234");
  await expect(seletor).toHaveAttribute("title", /Backend offline/);
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

test("mostra no diagnostico o motor, o modelo e o backend carregado", async ({ page }) => {
  await prepararPagina(page, { ort: ORT_LENTO });
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
  await expect(diag).toContainText("onnx-community/yolov10n");
  await page.locator("#start").click();
  await expect(diag).toContainText("motor deteccao");
  await expect(diag).toContainText("inferencia", { timeout: 15_000 });
  await page.locator("#stop").click();
});
