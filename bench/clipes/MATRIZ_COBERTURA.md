# Matriz de cobertura — clipes + anotações (Etapa 9 — item [3])

Mapeia os vídeos de `bench/videos/` para os conjuntos **tuning** (ajuste de
limiares, dev) e **eval** (números finais do comparativo A–D), com a cobertura
mínima exigida pelo roteiro. Este arquivo é versionado; `bench/BASELINE.md`
nunca é alterado.

Os binários de vídeo **não** são versionados (ver `.gitignore`); o que está
versionado aqui são as **anotações** (`.json`, formato de
`npm run qualidade`) e este mapeamento.

## Como rodar o harness contra um conjunto

```powershell
# gate da Fase 4; deve passar antes de usar números finais:
npm run validar:eval
# eval (números finais):
node scripts/benchmark-variantes.mjs --clipes-dir bench/videos --anotacoes-dir bench/clipes/eval --conjunto eval
# tuning (limiares):
node scripts/benchmark-variantes.mjs --clipes-dir bench/videos --anotacoes-dir bench/clipes/tuning --variantes B,C
# rodada reproduzível (Fase 5): warm-up separado + etapas isoladas + gate de qualidade
node scripts/benchmark-variantes.mjs --anotacoes-dir bench/clipes/eval --conjunto eval --warmups 1 --etapas-isoladas
```

Na rodada EVAL, passe um arquivo de eventos diferente para cada variante e
clipe, por exemplo `--eventos-B-car-detection.mp4 logs/B-car.jsonl`. Cada
arquivo precisa acompanhar seu sidecar `.jsonl.inicio` (por exemplo,
`logs/B-car.jsonl.inicio`); o harness ainda reconhece o formato legado
`logs/B-car.inicio`. Reutilizar um arquivo entre clipes mistura as bases
temporais e invalida a comparação.

A variante A usa o modo de frame único `eventos`. Para cada clipe, execute
`e2e/webcam.spec.ts` com `E2E_WEBCAM_MODE=eventos`, o caminho do vídeo em
`E2E_WEBCAM_CLIP` e um caminho próprio em `E2E_WEBCAM_EVENTOS`. O teste grava o
JSONL de eventos, o sidecar `<eventos>.jsonl.inicio` e
`<eventos>.ciclos.jsonl`; uma anotação
negativa pode legitimamente produzir zero eventos ou ciclos. O teste prepara o
modelo via `/api/visao/preparar`, aquece o detector fora da sessão medida e
reinicia a política de cooldown antes de tocar o clipe. A captura A usa os
mesmos limites de largura e qualidade JPEG das variantes multiframe.
Para fornecer os ciclos ao harness, consolide os cinco JSONL de ciclos
de cada variante em um arquivo por variante e passe-o em `--ciclos-A`
(analogamente para B/C/D).

O E2E multiframe abre `/?benchmark=eval`, ativando a política experimental
versionada de 1 s entre snapshots e interpretação a cada ciclo; a política
operacional da interface permanece inalterada. As requisições multimodais
registram os `frameIds` de origem em `visao.jsonl`, permitindo verificar o
modelo realmente usado para cada variante. Se o modelo local exceder o timeout
padrão de 90 s, defina `NEURO_VISION_TIMEOUT_MS=300000` antes de iniciar o E2E;
o timeout maior é aplicado ao processo do servidor sem alterar o padrão da
aplicação.

O `--anotacoes-dir` faz o harness procurar a anotação `<base>.json` primeiro no
conjunto e depois ao lado do vídeo. O `--conjunto <nome>` registra qual conjunto
reservado foi usado nos relatórios (protocolo e gate em
[`../DECISAO_ARQUITETURAL_2026-10-21.md`](../DECISAO_ARQUITETURAL_2026-10-21.md)).
Quando `--conjunto eval` é usado, o harness exige o diretório EVAL oficial e
bloqueia a rodada se `validar:eval` não comprovar a cobertura e a separação.
Nesse modo, processa somente os vídeos anotados no diretório EVAL oficial; não
herda sidecars de tuning ao lado dos vídeos.

## Conjunto EVAL (escopo reduzido aprovado; cobertura validada)

| Clipe | Duração | Cobertura | Anotação | Status |
|-------|--------:|-----------|----------|--------|
| `webcam-mudanca.webm` | 30 s | pessoa sai; negativo de movimento de objeto | `eval/webcam-mudanca.json` | ✅ verificada (v2) |
| `fruit-and-vegetable-detection.mp4` | 61 s | objetos atravessam esteira | `eval/fruit-and-vegetable-detection.json` | ✅ revisada por amostragem de 1 fps |
| `car-detection.mp4` | 30 s | carros cruzam o quadro | `eval/car-detection.json` | ✅ revisada por amostragem de 1 fps |
| `classroom.mp4` | 33 s | pessoas se movem; negativo de movimento de objeto | `eval/classroom.json` | ✅ revisada por amostragem de 1 fps |
| `head-pose-face-detection-female.mp4` | 135 s | movimentos de cabeça; negativo de movimento de objeto | `eval/head-pose-face-detection-female.json` | ✅ vídeo completo revisado a 1 fps |

Os eventos positivos de objetos foram anotados por amostragem, não quadro a
quadro. O comparador restrito a este alvo só considera detecções `movimento`
com origem `objetos` e rótulo do detector diferente de pessoa; eventos sem
rótulo não são tratados como prova de movimento de objeto.

**Fase 4 concluída em escopo reduzido, conforme autorizado pelo usuário:** o
manifesto cobre apenas `movimento_objeto.objeto_deslocado`, com três
ocorrências mínimas e três clipes negativos revisados. Aceno e interpretação
textual ficam explicitamente fora desta avaliação e não podem ser considerados
validados ou promovidos por estes resultados.

## Conjunto TUNING (rascunhos + limiares)

| Clipe | Duração | Cobertura pretendida | Anotação | Status |
|-------|--------:|----------------------|----------|--------|
| `webcam-atual.webm` | 10 s | aparição + movimento | `tuning/webcam-atual.json` | ✅ anotação de referência |
| `bottle-detection.mp4` | 40 s | cena estática, ausência de pessoa | `tuning/bottle-detection.json` | 📝 rascunho |
| `people-detection.mp4` | 50 s | pessoas, oclusões, movimento | `tuning/people-detection.json` | 📝 rascunho |
| `face-demographics-walking.mp4` | 61 s | ação contínua (caminhada) | `tuning/face-demographics-walking.json` | 📝 rascunho |
| `store-aisle-detection.mp4` | 65 s | oclusões (corredor) | `tuning/store-aisle-detection.json` | 📝 rascunho |
| `worker-zone-detection.mp4` | 76 s | oclusões, iluminação industrial | `tuning/worker-zone-detection.json` | 📝 rascunho |

## Outros cenários fora do escopo EVAL atual

| Cenário | Clipe | Conjunto | Estado |
|---------|-------|----------|--------|
| Ação lenta | `face-demographics-walking-and-pause` | eval | ⏳ anotação pendente |
| Ação rápida | `driver-action-recognition` | tuning | ⏳ anotação pendente (51 MB — sondagem por data URL estourou timeout) |
| Gestos distintos | `driver-action-recognition` | tuning | ⏳ anotação pendente |
| Oclusões | `store-aisle-detection`, `classroom` | tuning / eval | 📝 rascunho / ⏳ pendente |
| Iluminação ruim | `worker-zone-detection` | tuning | 📝 rascunho |
| Cena estática | `bottle-detection`, `car-detection` | tuning / eval | 📝 rascunho / ⏳ pendente |
| Ausência de pessoa | `car-detection`, `bottle-detection` | eval / tuning | 🏷️ `car-detection` identificado por anotação vazia (sem eventos) |
| Pessoa entra/sai (real) | `webcam-mudanca` | eval | ✅ |

## Regras das anotações

- Formato: `{ clip, duracaoMs, notas, eventos: [{ tipo, em, descricao }] }`
  (tipos: `aparicao`, `desaparecimento`, `movimento`, `mudanca_de_cena`,
  `resumo`, `qualquer`).
- Para EVAL, usar a versão 2 com `conjunto`, `revisao` e os campos de ação e
  visibilidade documentados em `bench/videos/README.md`.
- Cada vídeo pertence a apenas um split; tuning e eval não podem compartilhar
  a mesma gravação.
- A versão 2 registra o intervalo observado (`inicioMs`, `fimMs`), categoria
  (`gesto`, `postura`, `movimento_corporal`, `movimento_objeto`,
  `aparicao_desaparecimento`, `interpretacao_textual`), classe, visibilidade,
  parte envolvida e `determinavel`.
- `eval/manifest.json` fixa a classe de movimento de objeto com três
  ocorrências mínimas e três clipes negativos; `npm run validar:eval` verifica
  cobertura, revisão humana e separação dos splits.
- Eventos impossíveis de julgar ficam anotados com `determinavel: false`; o
  comparador os reporta à parte e não os trata como perdas.
- **Rascunho** = `eventos: []` + `notas` iniciando com "RASCUNHO": significa
  "sem evento esperado anotado ainda" — serve para medir FP/min no tuning,
  **não** para recall. Promover a eval só após revisão humana quadro a quadro.
- Negativos EVAL v2 exigem revisão concluída e são registrados como
  `casoNegativo` (ausência global) ou em `negativos` (ausência de alvos específicos).
- A base temporal `em` dos clipes de webcam vem do sidecar `<eventos>.inicio`
  gravado pelo E2E (`e2e/webcam.spec.ts` / `webcam-multiframe.spec.ts`).
- Nunca alterar `bench/BASELINE.md`; relatórios vão para
  `bench/RELATORIO_*` e `bench/COMPARATIVO_*`.
