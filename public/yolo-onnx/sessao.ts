import { ErroPercepcao } from "../../src/erros";
import { caminhosOnnxRuntime } from "../offline";
import { threadsWasm, webgpuDisponivel } from "../desempenho";
import type { RuntimeORT, SessaoORT } from "./tipos";

const cacheRuntime: Record<string, Promise<RuntimeORT>> = {};

/**
 * Carrega (com cache) o `onnxruntime-web`, do servidor local quando o modo
 * offline esta preparado, senao do CDN.
 */
export async function carregarRuntimeYolo(): Promise<RuntimeORT> {
  const caminhos = await caminhosOnnxRuntime();
  const url = caminhos.modulo;
  if (!(url in cacheRuntime)) {
    cacheRuntime[url] = import(/* @vite-ignore */ url)
      .then((modulo: RuntimeORT & { default?: RuntimeORT }) => {
        const ort = (modulo.default ?? modulo) as RuntimeORT;
        // Os `.wasm` ficam ao lado do modulo; sem isso o runtime tenta baixar
        // de um caminho relativo inexistente.
        ort.env.wasm.wasmPaths = caminhos.wasmPaths;
        // Com COOP/COEP (isolamento entre origens) o WASM usa ate 4 threads por
        // worker; sem isolamento fica em 1 e evitamos o aviso do runtime.
        ort.env.wasm.numThreads = threadsWasm();
        return ort;
      })
      .catch((erro: unknown) => {
        // Nao deixa promessa rejeitada no cache: se a rede voltar, a proxima
        // tentativa importa de novo.
        delete cacheRuntime[url];
        throw erro;
      });
  }
  return cacheRuntime[url];
}

const cacheSessoes: Record<string, Promise<SessaoORT>> = {};
/**
 * Contagem de referencias por URL: a sessao e compartilhada entre detectores
 * (COCO e NSFW) e so deve ser descartada quando o ultimo deles a libera. Sem
 * isso, encerrar um detector quebraria o outro que usa o mesmo modelo.
 */
const referenciasSessoes: Record<string, number> = {};
/**
 * Dispositivo efetivamente usado por sessao (`webgpu` so quando a criacao no
 * WebGPU funcionou; se o EP falhar, a sessao e recriada em WASM).
 */
const dispositivosSessoes: Record<string, "webgpu" | "wasm"> = {};

/** Dispositivo efetivo da sessao carregada para `url` (default: `wasm`). */
export function dispositivoSessaoYolo(url: string): "webgpu" | "wasm" {
  return dispositivosSessoes[url] ?? "wasm";
}

/**
 * Cria a sessao tentando WebGPU primeiro quando ha GPU e nao estamos sob
 * automacao. A GPU desta maquina (6 GB) cabe folgado no YOLOv10 nano; se a
 * criacao falhar por qualquer motivo, a mesma URL e recriada em WASM - o
 * resultado do produto nao depende do EP.
 */
async function criarSessaoComFallback(ort: RuntimeORT, url: string): Promise<SessaoORT> {
  if (webgpuDisponivel()) {
    try {
      const sessao = await ort.InferenceSession.create(url, {
        executionProviders: ["webgpu", "wasm"],
      });
      dispositivosSessoes[url] = "webgpu";
      return sessao;
    } catch {
      // GPU ocupada/driver sem suporte: segue para o WASM abaixo.
    }
  }
  const sessao = await ort.InferenceSession.create(url, { executionProviders: ["wasm"] });
  dispositivosSessoes[url] = "wasm";
  return sessao;
}

/**
 * Sessao de inferencia por URL (compartilhada por todos os detectores que
 * rodam no runtime — COCO e NSFW — para nao baixar/instanciar duas vezes).
 *
 * Cada chamada incrementa a contagem de referencias; o chamador deve parear
 * com `liberarSessaoYolo(url)` em `encerrar()`. `carregarRuntime` e injetavel
 * apenas para testes (default: o runtime real do CDN).
 */
export function obterSessaoYolo(
  url: string,
  carregarRuntime: () => Promise<RuntimeORT> = carregarRuntimeYolo
): Promise<SessaoORT> {
  referenciasSessoes[url] = (referenciasSessoes[url] ?? 0) + 1;
  if (!(url in cacheSessoes)) {
    cacheSessoes[url] = (async () => {
      const ort = await carregarRuntime();
      return criarSessaoComFallback(ort, url);
    })().catch((erro: unknown) => {
      delete cacheSessoes[url];
      delete referenciasSessoes[url];
      delete dispositivosSessoes[url];
      throw new ErroPercepcao(
        "detector",
        `Falha ao carregar o modelo YOLO ONNX (${String(erro)}).`,
        { cause: erro }
      );
    });
  }
  return cacheSessoes[url];
}

/**
 * Libera uma referencia de sessao (pareamento com `obterSessaoYolo`). Quando o
 * ultimo detector que usa a URL a libera, a sessao e descartada de verdade
 * (`dispose`, quando o runtime suporta) e removida do cache — uma proxima
 * `carregar` baixa/instancia de novo, como esperado num encerramento real.
 */
export function liberarSessaoYolo(url: string): void {
  const atual = referenciasSessoes[url];
  if (atual === undefined) return;
  const restantes = atual - 1;
  if (restantes > 0) {
    referenciasSessoes[url] = restantes;
    return;
  }
  delete referenciasSessoes[url];
  delete dispositivosSessoes[url];
  const pendente = cacheSessoes[url];
  delete cacheSessoes[url];
  void pendente
    ?.then((sessao) => {
      const descartavel = sessao as SessaoORT & { dispose?: () => Promise<void> | void };
      void descartavel.dispose?.();
    })
    .catch(() => {
      // Sessao nunca carregou: nada a liberar.
    });
}
