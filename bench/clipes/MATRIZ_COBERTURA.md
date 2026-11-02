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

O `--anotacoes-dir` faz o harness procurar a anotação `<base>.json` primeiro no
conjunto e depois ao lado do vídeo. O `--conjunto <nome>` registra qual conjunto
reservado foi usado nos relatórios (protocolo e gate em
[`../DECISAO_ARQUITETURAL_2026-10-21.md`](../DECISAO_ARQUITETURAL_2026-10-21.md)).
Quando `--conjunto eval` é usado, o harness exige o diretório EVAL oficial e
bloqueia a rodada se `validar:eval` não comprovar a cobertura e a separação.

## Conjunto EVAL (anotações verificadas — números finais)

| Clipe | Duração | Cobertura | Anotação | Status |
|-------|--------:|-----------|----------|--------|
| `webcam-mudanca.webm` | 30 s | cena estática → desaparecimento único | `eval/webcam-mudanca.json` | ✅ verificada (v2, intervalo e metadados humanos) |

Candidatos **pendentes de anotação humana** (não usar em eval até revisar):
`one-by-one-person-detection.mp4` (139 s — sequência de ações),
`face-demographics-walking-and-pause.mp4` (91 s — ação lenta + pausa),
`classroom.mp4` (33 s — oclusões/múltiplas pessoas),
`car-detection.mp4` (30 s — cena sem pessoa).

**Fase 4 em andamento:** o formato v2 registra categoria/classe, início/fim,
visibilidade, parte envolvida e determinabilidade; o comparador exclui eventos
indeterminados das métricas. O EVAL ainda tem somente um clipe e não alcança a
cobertura mínima de várias ocorrências por classe nem negativos revisados. Não
promover variantes com base neste conjunto até revisar os candidatos e atualizar
esta matriz.

## Conjunto TUNING (rascunhos + limiares)

| Clipe | Duração | Cobertura pretendida | Anotação | Status |
|-------|--------:|----------------------|----------|--------|
| `webcam-atual.webm` | 10 s | aparição + movimento | `tuning/webcam-atual.json` | ✅ anotação de referência |
| `bottle-detection.mp4` | 40 s | cena estática, ausência de pessoa | `tuning/bottle-detection.json` | 📝 rascunho |
| `people-detection.mp4` | 50 s | pessoas, oclusões, movimento | `tuning/people-detection.json` | 📝 rascunho |
| `face-demographics-walking.mp4` | 61 s | ação contínua (caminhada) | `tuning/face-demographics-walking.json` | 📝 rascunho |
| `store-aisle-detection.mp4` | 65 s | oclusões (corredor) | `tuning/store-aisle-detection.json` | 📝 rascunho |
| `worker-zone-detection.mp4` | 76 s | oclusões, iluminação industrial | `tuning/worker-zone-detection.json` | 📝 rascunho |

## Cobertura mínima exigida × estado

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
- `eval/manifest.json` fixa, antes da rodada, sete classes-alvo com três
  ocorrências mínimas cada e dois clipes negativos; `npm run validar:eval`
  verifica a cobertura, revisão humana e separação dos splits.
- Eventos impossíveis de julgar ficam anotados com `determinavel: false`; o
  comparador os reporta à parte e não os trata como perdas.
- **Rascunho** = `eventos: []` + `notas` iniciando com "RASCUNHO": significa
  "sem evento esperado anotado ainda" — serve para medir FP/min no tuning,
  **não** para recall. Promover a eval só após revisão humana quadro a quadro.
- Um negativo EVAL v2 exige `casoNegativo: true` e `revisao.status: "revisada"`;
  um array vazio sem essa confirmação não conta como cobertura negativa.
- A base temporal `em` dos clipes de webcam vem do sidecar `<eventos>.inicio`
  gravado pelo E2E (`e2e/webcam.spec.ts` / `webcam-multiframe.spec.ts`).
- Nunca alterar `bench/BASELINE.md`; relatórios vão para
  `bench/RELATORIO_*` e `bench/COMPARATIVO_*`.
