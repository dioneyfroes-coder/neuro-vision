import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "public/app.js",
      "node_modules/**",
      // Artefatos do modo offline + pesos NSFW experimentais e venv de export
      // (gitignored; codigo de terceiros/pesos, nunca lintar).
      "vendor/**",
      "modelos/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // O nucleo de dominio nao conhece APIs de modelos: YOLO, MediaPipe e
    // Transformers.js entram apenas pelos adaptadores (principio 10 do roteiro).
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@xenova/*",
                "@huggingface/*",
                "@mediapipe/*",
                "@mediapipe/tasks-vision",
                "transformers",
                "yolo*",
              ],
              message:
                "Tipos de dominio nao podem depender de SDKs de modelo; use os contratos de src/domain/perception.ts.",
            },
            {
              group: ["../public/*", "../../public/*"],
              message:
                "O dominio nao importa modulos do navegador; a dependencia e no sentido contrario.",
            },
          ],
        },
      ],
    },
  }
);
