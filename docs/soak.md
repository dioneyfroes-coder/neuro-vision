# Soak test de monitoramento — Neuro Vision

O soak test mantém o servidor de monitoramento sob carga contínua de quadros por
um período longo e avalia **telemetria real** coletada de `/api/health`, do índice
de segmentos e do armazenador de vídeos. Ele responde a perguntas de resistência:
a rotação de segmentos continua coerente depois de milhares de quadros? As
lacunas injetadas aparecem no índice? Os bytes dos segmentos fechados chegam ao
disco? Há erro HTTP ou crescimento de memória ao longo da janela?

```bash
# 30 minutos em tempo real (padrão) — modo de aceite
node --import tsx scripts/soak-monitoramento.mjs

# diagnóstico rápido: mesma quantidade de requisições, tempo simulado 100x
node --import tsx scripts/soak-monitoramento.mjs --acelerar 100 --permitir-inconclusivo

# sem gravar bytes de vídeo (verifica só índice, quadros e telemetria)
node --import tsx scripts/soak-monitoramento.mjs --sem-videos --duracao-ms 120000

node --import tsx scripts/soak-monitoramento.mjs --ajuda
```

O script sobe um `createServer` isolado em uma porta efêmera de `127.0.0.1`, com
logs e vídeos em diretório temporário do sistema (`neuro-soak-*`), removido ao
final. O backend de visão é apontado para uma porta fechada de propósito: o soak
não usa inferência e `/api/health` falha rápido nessa consulta. O único artefato
no repositório é o relatório em `logs/soak/` (já ignorado pelo git).

## O que é medido

- **Quadros e segmentos**: cada tick envia um quadro com `capturadoEmMs` sintético;
  o avaliador confere se a soma de `quadros` dos segmentos fecha com a quantidade
  esperada, se não há ids duplicados nem sobreposição `[inicioMs, fimMs)`.
- **Lacunas reais**: em 25%, 55% e 80% da duração simulada o harness simplesmente
  deixa de enviar quadros por uma janela de pelo menos três ticks. A lacuna só
  conta como explicada se algum `lacunas[]` de segmento tiver `duracaoMs > 0` e
  interseção temporal com a janela injetada.
- **Bytes de vídeo**: para todo segmento fechado/incompleto ainda sem arquivo, o
  script faz `POST /api/monitoramento/videos/:segmentoId` com 1024 bytes e
  `Content-Type: video/webm`. O tamanho agregado lido de
  `sistema.armazenamento.bytesTotal` alimenta `bytesVideo` das amostras.
- **Saúde do processo**: `sistema.cpu.usoPercentual` (nulo na primeira leitura),
  `sistema.ram.rssBytes`, `sistema.ram.heapUsedBytes` e os contadores de
  `monitoramento` vêm do `/api/health`. O crescimento de RSS usa `max - min`
  entre amostras, em MB. Em CPU multicore o percentual pode passar de 100%; isso
  é o valor informado pelo servidor, não um erro de arredondamento.
- **Erros HTTP**: qualquer status `>= 400`, quadro rejeitado ou falha de rede é
  contabilizado e aparece como problema.

O módulo puro `src/monitoramento/validacao-soak.ts` faz a avaliação sem relógio,
sem filesystem e sem rede; os testes em `tests/soak-validacao.test.ts` usam
timestamps sintéticos e cobrem cada critério de reprovação.

## O que NÃO é medido

- **Não usa MediaRecorder, câmera nem codec**: os "vídeos" são buffers de 1024
  bytes zerados. O soak valida o caminho de aceitação, persistência e contagem de
  bytes; não valida que o vídeo é reproduzível. Captura real com MediaRecorder é
  coberta pelo E2E (`e2e/`).
- **Não mede modelos, inferência, detecções nem qualidade de eventos.** Isso é
  benchmark/qualidade, não resistência do gravador.
- **Não simula clientes navegador, reconexão ou rede externa.** Todas as chamadas
  são locais e sequenciais.
- **GPU fica `null` no health quando não há API real** (`sistema.gpu` traz
  `utilizacaoPercentual: null` e o motivo). O relatório não inventa uso de GPU.

## Modo real × modo acelerado

Sem `--acelerar`, o loop respeita o tick de parede: com os padrões são 30 minutos
reais, 1800 quadros e uma leitura de health a cada 5 s de tempo simulado.

Com `--acelerar N` (inteiro `>= 1`) cada tick **simulado** vale `tickMs × N`, mas
a **quantidade de requisições não muda** — continuam sendo `duracaoMs / tickMs`
(1800 no padrão, mesmo a 100x). Não há espera real entre ticks, então a execução
termina no tempo das próprias requisições. A duração simulada total passa a ser
`duracaoMs × N`, e `duracaoSegmentoMs` e `limiarLacunaMs` são escalados pelo mesmo
fator para que a cadência normal não seja confundida com lacuna. As janelas
injetadas também usam o tempo simulado escalado.

Isso torna o modo acelerado útil para investigar estrutura e telemetria, **nunca
para aceite**: o veredito é sempre `INCONCLUSIVO`, e o script termina com exit
code `1` a menos que `--permitir-inconclusivo` seja informado. A medição de RSS
vira diagnóstico, não critério de aprovação.

## Vereditos

| Veredito | Significado | Exit code |
| --- | --- | --- |
| `APROVADO` | Sem problemas, com amostras, duração `>= 60 s` e tempo real | `0` |
| `REPROVADO` | Pelo menos um problema observado, mesmo em modo acelerado/curto | `1` |
| `INCONCLUSIVO` | Sem problemas, mas sem amostras, acelerado ou com duração `< 60 s` | `1` (ou `0` com `--permitir-inconclusivo`) |

Problemas têm precedência: uma falha real reprova mesmo quando a janela não
seria suficiente para aceite. `null` em CPU permanece `null` no relatório; nenhum
valor é preenchido para esconder ausência de medição.

## Critério de aceite

O aceite exige **todos** os itens abaixo em execução de tempo real:

1. nenhuma sobreposição de segmentos e nenhum id duplicado;
2. nenhum quadro perdido (soma de `quadros` = quadros esperados);
3. as três lacunas injetadas explicadas por lacunas registradas com duração
   positiva e interseção temporal;
4. todo segmento fechado/incompleto com bytes enviados (ausente só com
   `--sem-videos`, que desativa este critério);
5. zero erros HTTP;
6. crescimento de RSS dentro de `--max-crescimento-rss-mb` (padrão 80 MB).

## Relatório

`--relatorio` aceita um caminho relativo à raiz do repositório; o padrão é
`logs/soak/relatorio-<ISO>.json`. O JSON contém:

- `data`: instante da escrita;
- `config`: opções usadas e valores efetivos (duração/passo simulados e limites
  escalados da sessão);
- `metricas`: duração, quadros contabilizados/esperados, totais de segmentos e
  lacunas, RSS inicial/final/máximo, crescimento em MB, pico de CPU (ou `null`),
  bytes finais de vídeo, bytes por hora e segmentos por minuto;
- `veredito`, `problemas`, `notas`: resultado e ressalvas (por exemplo, "memória
  diagnóstica" no modo acelerado);
- `amostras`: uma entrada por leitura de health — `emMs` é o tempo simulado
  relativo ao início; `rssBytes`, `heapBytes`, `bytesVideo`, `quadros`,
  `segmentos` e `lacunas` vêm do servidor;
- `lacunasInjetadas`: as três janelas relativas ao início da sessão, no mesmo
  tempo simulado de `amostras`;
- `videosFechados`: ids dos segmentos cujo upload respondeu `201`.

Nenhum campo é estimado a partir de tendência: se uma leitura não trouxe CPU, o
valor é `null`; se não houve amostra, os agregados de memória são zero e o
veredito é inconclusivo.

## Resultado registrado — 2026-11-22

Execução em tempo real com os padrões (`npm run validar:soak`, `acelerar: 1`,
30 min, 1800 ticks, 3 lacunas injetadas):

| Métrica | Valor |
| --- | ---: |
| Veredito | `APROVADO` (`problemas: []`, exit 0) |
| Quadros contabilizados / esperados | 1792 / 1792 |
| Segmentos | 180 (6/min, um a cada 10 s) |
| Lacunas registradas | 3 (uma por janela injetada) |
| Uploads de vídeo | 180 / 180 arquivos indexados |
| Crescimento de RSS (máx − mín) | 15,58 MB (limite 80 MB) |
| RSS inicial → final | 73,38 MB → 81,99 MB |
| CPU mediana / p95 / p99 | 3,44% / 7,48% / 8,75% |
| Pico de CPU | 97,34% |
| Erros HTTP | 0 |

O pico de CPU é o **último sample**, coletado depois dos 180 uploads e do
fechamento da sessão na fase de `concluir()`: é uma rajada de coleta/teardown,
não carga sustentada. Dos 361 samples com CPU disponível, apenas 1 passou de
10%; a primeira leitura permanece `null`.

Relatório completo: `logs/soak/relatorio-2026-11-22T20-00-38-534Z.json`
(gitignored). O veredito cobre o gravador e o índice do servidor — **não** cobre
`MediaRecorder`, câmera real, codec, inferência nem a cadência adaptativa da
Fase 3; ver [`pendencias.md`](./pendencias.md).
