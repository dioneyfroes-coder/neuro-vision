# Estado inicial - Fase 0 (resumo)

Data: 2026-10-12 · Branch: `fix/percepcao-temporal` · Commit: `e55aeef`

> **Papel histórico.** Este é o **resumo** do estado da base **antes** das
> correções de percepção temporal, condensado do transcrito bruto que media
> (saídas de typecheck/lint/testes/build exatamente como saíram na máquina).
> O transcrito completo — com os erros detalhados de `src/ollama.ts`,
> `src/ollama.test.ts` e as 32 falhas de teste — está preservado no histórico
> do Git (commit `4ae025d`), não no repositório atual. A camada Ollama foi
> removida depois; ver [`docs/modos.md`](./docs/modos.md).
>
> As medições de qualidade estão em [`bench/comparativo-2026-10-15.md`](./bench/comparativo-2026-10-15.md);
> o estado congelado antes da modularização está em
> [`bench/baseline-modularizacao-2026-10-16.json`](./bench/baseline-modularizacao-2026-10-16.json).

## Verificações iniciais (2026-10-12)

| Verificação | Resultado |
| --- | --- |
| Typecheck | **Com erros** — 4 erros TS em `src/ollama.ts` e `src/ollama.test.ts` (arquivos já removidos) |
| Lint | OK (sem erros) |
| Testes | **Falham** — 32 falhas de 322 testes (arquivos `ollama.test.ts` e `server.test.ts`) |
| Build | OK (servidor e cliente compilam) |

## Hardware de referência

Intel Xeon E5-2660 v3 (20 núcleos), ~15,8 GB RAM, AMD Radeon RX 5600 OEM,
Windows 10, Node v24.19.0. Detalhes e metas em [`bench/BASELINE.md`](./bench/BASELINE.md).

## Valores de referência (bench/BASELINE.md)

Precisão 25% · Recall 100% · ~6 falsos positivos/min · latência ~3,4 s.
