#!/usr/bin/env node

/**
 * Exporta os pesos NSFW experimentais (`yolonsfw/*.pt`) para ONNX.
 *
 * A pasta `yolonsfw/` e **gitignored**: os pesos nunca sao commitados. O
 * servidor localiza os `.onnx` exportados ali e os serve em `/yolonsfw/`
 * (`src/server.ts`); sem export, o toggle "NSFW (experimental)" da interface
 * falha com instrucao de como gerar os arquivos.
 *
 * Para cada `.pt` o script:
 * 1. carrega o modelo com `ultralytics` (venv em `yolonsfw/.venv`, ou o python
 *    do sistema);
 * 2. exporta `format="onnx"` com `imgsz=640` e `nms=True` — mesma saida
 *    `[1, 300, 6]` e o mesmo pre-pos-processamento do detector COCO
 *    (`public/yolo-onnx.ts`/`public/nsfw-onnx.ts`);
 * 3. grava o sidecar `<modelo>.onnx.json` com os nomes de classe do proprio
 *    modelo (o cliente usa os rotulos dele, sem tabela duplicada).
 *
 * Requisitos (uma vez): `python -m venv yolonsfw/.venv` e dentro dele
 * `pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu`
 * e `pip install ultralytics onnx onnxslim`.
 *
 * Uso:
 *   node scripts/exportar-yolo-nsfw.mjs            # todos os .pt de yolonsfw/
 *   node scripts/exportar-yolo-nsfw.mjs yolonsfw/erax_nsfw_yolo11n.pt
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR_PESOS = path.join(ROOT, "yolonsfw");
const DIR_VENV = path.join(DIR_PESOS, ".venv");

/** Python do venv de export quando existe; senao o python do sistema. */
function resolverPython() {
  const venv = path.join(
    DIR_VENV,
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python"
  );
  if (existsSync(venv)) return venv;
  return process.platform === "win32" ? "python" : "python3";
}

/** Codigo python embutido: exporta um `.pt` e grava o sidecar de classes. */
const CODIGO_EXPORTACAO = `
import json, sys, datetime
from pathlib import Path
from ultralytics import YOLO

pt = Path(sys.argv[1])
sidecar = Path(sys.argv[2])
model = YOLO(str(pt))
saida = Path(str(model.export(format="onnx", imgsz=640, nms=True)))
reloaded = YOLO(str(saida))
names = reloaded.names
classes = [names[k] for k in sorted(names)] if isinstance(names, dict) else list(names)
sidecar.write_text(json.dumps({
    "classes": classes,
    "origem": pt.name,
    "imgsz": 640,
    "nms": True,
    "exportadoEm": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"EXPORTADO {saida.name} ({len(classes)} classes: {', '.join(classes)})")
`;

function verificarAmbiente(python) {
  const cheque = spawnSync(python, ["-c", "import ultralytics"], { encoding: "utf8" });
  if (cheque.status !== 0) {
    console.error(`ultralytics nao encontrado em ${python}.`);
    console.error("Crie o venv de export e instale as dependencias:");
    console.error("  python -m venv yolonsfw\\.venv");
    console.error(
      "  yolonsfw\\.venv\\Scripts\\python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu"
    );
    console.error("  yolonsfw\\.venv\\Scripts\\python -m pip install ultralytics onnx onnxslim");
    process.exit(1);
  }
}

function listarPesos(argumentos) {
  const alvos = argumentos.length
    ? argumentos.map((a) => path.resolve(ROOT, a))
    : readdirSync(DIR_PESOS)
        .filter((n) => n.toLowerCase().endsWith(".pt"))
        .map((n) => path.join(DIR_PESOS, n));
  const faltando = alvos.filter((a) => !existsSync(a));
  if (faltando.length) {
    console.error(`Pesos nao encontrados: ${faltando.join(", ")}`);
    process.exit(1);
  }
  return alvos;
}

function main() {
  const argumentos = process.argv.slice(2);
  if (argumentos.includes("--help") || argumentos.includes("-h")) {
    console.log("Uso: node scripts/exportar-yolo-nsfw.mjs [modelo.pt ...]");
    console.log("Sem argumentos, exporta todos os .pt de yolonsfw/ para ONNX (gitignored).");
    return;
  }
  if (!existsSync(DIR_PESOS)) {
    console.error(`Diretorio inexistente: ${DIR_PESOS} (os pesos NSFW nao sao commitados).`);
    process.exit(1);
  }
  const python = resolverPython();
  verificarAmbiente(python);

  let falhas = 0;
  for (const pt of listarPesos(argumentos)) {
    const nome = path.basename(pt).replace(/\.pt$/i, "");
    const onnx = path.join(DIR_PESOS, `${nome}.onnx`);
    const sidecar = `${onnx}.json`;
    console.log(`Exportando ${path.relative(ROOT, pt)} ...`);
    const r = spawnSync(python, ["-c", CODIGO_EXPORTACAO, pt, sidecar], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (r.status !== 0) {
      falhas += 1;
      console.error(`  FALHA: ${(r.stderr || r.stdout || "").trim().split("\n").slice(-5).join("\n")}`);
      continue;
    }
    const linha = (r.stdout || "").trim().split("\n").pop();
    console.log(`  ${linha}`);
    if (existsSync(onnx)) {
      const mb = statSync(onnx).size / 1e6;
      console.log(`  ${path.relative(ROOT, onnx)} (${mb.toFixed(1)} MB) + sidecar de classes`);
    }
  }

  console.log(
    falhas
      ? `\n${falhas} exportacao(oes) falhou(aram).`
      : "\nPronto. Pesos em yolonsfw/ (gitignored, nunca commitar) e servidos em /yolonsfw/."
  );
  process.exit(falhas ? 1 : 0);
}

main();
