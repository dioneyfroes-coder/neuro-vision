import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Permite testar `public/detector.ts` em Node: a URL do CDN (externa no
      // bundle) aponta para um stub controlavel durante os testes.
      "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1": fileURLToPath(
        new URL("./src/transformers.stub.ts", import.meta.url)
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
