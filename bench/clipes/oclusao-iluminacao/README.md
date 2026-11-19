# Conjunto reservado — iluminação e oclusão (Fase 7)

Este diretório fixa o protocolo para medir o que os testes sintéticos de
`tests/qualidade-eventos.test.ts` **não** medem: se a política continua
reconhecendo contraluz, oclusão parcial e ambiente escuro como
`baixa_confianca` em vídeo real.

> **Estado atual: sem evidência aceita.** O harness existe e está coberto por
> `tests/avaliacao-condicoes.test.ts`, mas não há clipes revisados por pessoa.
> Rodá-lo agora produz `INCONCLUSIVO` — nunca um número de precisão/recall
> apresentado como resultado final. O modelo em
> [`formato/exemplo-anotacao.json`](./formato/exemplo-anotacao.json) fica em
> subpasta e mostra apenas o formato; anotações em rascunho são ignoradas no
> cálculo e viram pendência.

## O que gravar

- Três ocorrências **revisadas** por condição: `oclusao_parcial`, `contraluz`,
  `ambiente_escuro`. Um mesmo clipe pode conter mais de uma, mas cada intervalo
  precisa ter início e fim conferidos.
- Pelo menos **dois clipes negativos revisados**, sem nenhuma das condições
  alvo, para medir falsos positivos por minuto.
- Clipes curtos (10–30 s), mesma enquadragem do uso alvo, com consentimento das
  pessoas filmadas. Os binários ficam **fora do versionamento** (`.gitignore`);
  aqui entram somente as anotações `.json`.
- Revisão humana com `revisao.status: "revisada"`. A anotação deve registrar
  `clip`, `duracaoMs`, `revisao.metodo` e, por evento, `condicao`, `em`,
  `inicioMs`, `fimMs`, `visibilidade` e `determinavel`. Intervalos que não podem
  ser julgados devem usar `determinavel: false` e são contados à parte.

## Como medir

1. Reproduza cada clipe no app com os modelos reais (sem stubs), no modo
   **Eventos**, e salve os eventos observados em JSONL. Cada linha:

   ```json
   { "clip": "oclusao-parcial.mp4", "classe": "baixa_confianca", "emMs": 5000, "motivo": "baixa_confianca" }
   ```

   `classe` pode ser `baixa_confianca`, `movimento`, `nova_entidade`,
   `desaparecimento`, `resumo` ou `outro`. O instante `emMs` é relativo ao
   início do clipe.

2. Aponte o manifesto para o arquivo de eventos e rode:

   ```powershell
   node --import tsx scripts/validar-condicoes.mjs --eventos logs/condicoes/eventos.jsonl
   # para inspecionar sem exigir dados revisados:
   node --import tsx scripts/validar-condicoes.mjs --permitir-inconclusivo
   ```

3. O relatório JSON vai para `logs/condicoes/` (ignorado pelo git).

## Critério de aceite

- **Esperado:** evento `baixa_confianca` dentro da janela anotada (com
  tolerância de 2 s para a cadência de amostragem e sobreposição mínima de
  0,5 pelo coeficiente interseção/menor intervalo).
- **Violação:** evento classificado como `movimento`, `nova_entidade` ou
  `desaparecimento` dentro da janela degradada. Qualquer violação reprova.
- **Falso positivo:** `baixa_confianca` sem janela correspondente no mesmo
  clipe. Limite: 1 por minuto.
- **Mínimos:** precisão ≥ 0,90, recall ≥ 0,80, três ocorrências revisadas por
  condição e dois clipes negativos revisados.
- `REPROVADO` prevalece sobre `INCONCLUSIVO`. Sem dados revisados suficientes,
  o veredito é `INCONCLUSIVO` e o comando termina com código não zero, a menos
  que `--permitir-inconclusivo` seja usado para diagnóstico.

A regra pura está em `src/domain/avaliacao-condicoes.ts`; o protocolo de
anotação geral está em [`../videos/README.md`](../videos/README.md) e o mapa de
cobertura em [`../MATRIZ_COBERTURA.md`](../MATRIZ_COBERTURA.md).
