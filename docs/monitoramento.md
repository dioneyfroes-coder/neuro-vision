# Monitoramento e gravação segmentada (Fase 3)

Núcleo determinístico do modo **Câmera de Segurança**: sessões de monitoramento, segmentos de vídeo de 5 minutos, lacunas explícitas e buffer circular pré-evento. O objetivo é que a gravação rode **independente** do ciclo de snapshots da interface — a análise multimodal pode atrasar ou falhar sem interromper a linha do tempo de vídeo.

> **Escopo atual.** Esta página documenta o que já existe: os contratos de domínio (`src/domain/monitoramento.ts`), as classes puras (`src/monitoramento/gerenciador-gravacao.ts` e `src/monitoramento/buffer-circular.ts`), o serviço que compõe a sessão com um índice durável (`src/monitoramento/servico-monitoramento.ts`) e as rotas `/api/monitoramento/*`. A gravação dos **bytes** de vídeo, o armazenamento dos arquivos, a retenção automática, a criptografia e a interface ainda **não** foram implementados. Nada aqui deve ser lido como "o vídeo já é gravado em produção": o índice descreve sessões e segmentos, não conteúdo de vídeo.

## Contratos

| Tipo | Papel |
| --- | --- |
| `SessaoMonitoramento` | Ambiente, início/fim, estado (`ativa`, `pausada`, `encerrada`, `interrompida`) e parâmetros da sessão. |
| `VideoSegment` | Faixa `[inicioMs, fimMs)` com sequência, quantidade de quadros, estado (`gravando`, `fechado`, `incompleto`), motivo de fim e lacunas. |
| `LacunaGravacao` | Intervalo sem quadros (`sem_quadros`) ou falha relatada (`falha`), com duração explícita. |
| `QuadroGravado` | Metadados mínimos entregues pelo gravador: `frameId` + `capturadoEmMs`. |
| `QuadroAtribuido` | Resposta da atribuição: segmento, sequência e `offsetMs` dentro do segmento. |
| `QuadroRejeitadoError` | Rejeição explícita com motivo (`tempo_invalido`, `fora_de_ordem`, `sem_sessao`, `sessao_pausada`, `sessao_encerrada`). |

Padrões: `DURACAO_SEGMENTO_PADRAO_MS = 5 min`, `RETENCAO_PRE_EVENTO_PADRAO_MS = 10 s` e `LIMIAR_LACUNA_PADRAO_MS = 2 s`.

## Gerenciador de gravação

O `GerenciadorGravacao` não lê o relógio, não abre arquivo e não conhece codec. Quem grava chama `quadro()` com o instante de **captura**; o gerenciador decide o segmento.

```ts
const gravacao = new GerenciadorGravacao({ limiarLacunaMs: 2000 });
gravacao.iniciar({ ambiente: "sala", agoraMs: Date.now() });

const inicio = Date.now();
const atribuicao = gravacao.quadro({ frameId: "f-1", capturadoEmMs: inicio });
// { segmentoId, sequenciaSegmento: 1, offsetMs: 0, frameId: "f-1" }

gravacao.pausar();
gravacao.retomar();   // o próximo quadro abre um segmento novo
gravacao.encerrar(Date.now());
```

### Rotação sem perda nem sobreposição

- Segmentos normais cobrem `[inicioMs, fimMs)`.
- Ao atingir `duracaoSegmentoMs`, o segmento fecha **no limite exato** e o próximo começa nesse mesmo limite. Um quadro no limite (`capturadoEmMs === fimMs`) pertence ao segmento **posterior**, com `offsetMs = 0`.
- Não há sobreposição: `segmento[i + 1].inicioMs === segmento[i].fimMs`.
- `quadros` conta apenas atribuições reais. O último segmento pode ter menos de 5 minutos.

### Lacunas são explícitas

- Um intervalo entre quadros maior que `limiarLacunaMs` fecha o segmento como `incompleto`, com `motivoFim: "lacuna"` e uma `LacunaGravacao` de motivo `sem_quadros`.
- O `fimMs` do segmento é o **último quadro realmente gravado**; o trecho sem gravação não é anunciado como coberto.
- O novo segmento começa no primeiro quadro após a lacuna, não no limite teórico perdido.
- Um salto que atravessa um segmento inteiro sem quadros também vira lacuna, mesmo que `limiarLacunaMs` seja maior que a duração do segmento.
- Pausa intencional **não** é lacuna: o segmento fecha no último quadro com `motivoFim: "pausa"`, e a retomada abre outro segmento sem registrar buraco.
- Encerramento fecha no último quadro com `motivoFim: "sessao_encerrada"`; o intervalo até o comando não é coberto.
- `interromper()` representa falha anormal: o segmento em curso fica `incompleto`, com lacuna de motivo `falha`, e os segmentos já fechados permanecem consultáveis. Uma falha não apaga o histórico anterior.

### Consultas e vínculo com eventos

- `segmentosParaIntervalo(inicio, fim)` usa extremos **inclusivos**: um evento exatamente no limite entre dois segmentos referencia ambos.
- `segmentoParaTimestamp(instante)` devolve o segmento que contém o instante (no limite, o posterior) ou `undefined` quando o instante cai em pausa/lacuna. Ele nunca inventa cobertura.
- `listarSegmentos()`, `segmentoEmGravacao()` e `obterSessao()` devolvem cópias defensivas: o chamador não altera o estado interno.

Os eventos temporais ainda **não** carregam `segmentoId`; o vínculo será feito na integração com a persistência/UI, chamando as consultas acima com `inicioEm`/`fimEm` do evento.

## Buffer circular pré-evento

`BufferCircularQuadros<T>` guarda os últimos `retencaoMs` de quadros **por tempo de captura** (não por relógio de parede), com teto opcional de capacidade.

```ts
const buffer = new BufferCircularQuadros<QuadroGravado>({
  retencaoMs: 10_000,
  capacidadeMaxima: 300,
  clonarItem: (quadro) => ({ ...quadro }),
});

buffer.adicionar(quadro, quadro.capturadoEmMs);
const janela = buffer.instantaneo(); // mais antigo → mais recente
```

- A retenção é medida a partir do quadro mais recente; o limite é inclusivo (`capturadoEmMs === maisRecenteMs - retencaoMs` permanece).
- Timestamps não finitos são rejeitados (`tempo_invalido`); quadros fora de ordem são rejeitados (`fora_de_ordem`) sem alterar a janela.
- Com `capacidadeMaxima`, o quadro mais antigo é descartado primeiro.
- `instantaneo()` devolve um novo array e novos envelopes; `clonarItem` permite copiar também o conteúdo do item. Sem ele, a cópia é estrutural — o item em si continua compartilhado.
- `limpar()` zera a janela; `maisRecenteMs` e `maisAntigoMs` expõem os extremos.

## Índice durável de sessões e segmentos

`ServicoMonitoramento` mantém **uma** sessão viva no `GerenciadorGravacao` e grava o índice em JSONL append-only (`src/persistence/repositorio-monitoramento.ts`):

- `logs/monitoramento-sessoes.jsonl` — uma linha por transição de sessão (início, pausa, retomada, encerramento/interrupção);
- `logs/monitoramento-segmentos.jsonl` — uma linha na abertura (`gravando`) e outra no desfecho de cada segmento (`fechado`/`incompleto`), com `motivoFim` e lacunas.

A leitura mantém a **versão mais recente por `sessaoId`/`segmentoId`** e ordena sessões da mais recente para a mais antiga e segmentos em ordem cronológica. Reiniciar o processo perde a sessão viva (o gerenciador não é reidratado), mas o histórico do índice continua consultável — inclusive as lacunas. Uma sessão que ficou `ativa` no índice após uma queda permanece registrada como estava; a recuperação automática desse estado ainda não existe (ver pendências).

Regras de escrita que valem registrar:

- **Nenhuma linha por quadro.** `quadros`/`fimMs` do segmento em gravação mudam a cada frame, mas a assinatura publicada ignora esses campos enquanto o segmento está `gravando`; os contadores finais entram no fechamento. O arquivo cresce com o número de segmentos, não com o número de frames.
- **Cópia defensiva.** O índice grava o que o gerenciador devolve; alterar o objeto recebido pela API não muda o estado interno.
- **`limit` conta atualizações**, não registros únicos: uma sessão com várias transições consome mais de uma linha do limite. A consulta devolve no máximo `limit` atualizações deduplicadas.

```ts
const servico = new ServicoMonitoramento({
  sessoesFile: "logs/monitoramento-sessoes.jsonl",
  segmentosFile: "logs/monitoramento-segmentos.jsonl",
});
const sessao = await servico.iniciar({ ambiente: "sala", agoraMs: Date.now() });
await servico.enviarQuadros([{ frameId: "f-1", capturadoEmMs: Date.now() }]);
await servico.encerrar(sessao.sessaoId, Date.now());
```

## Rotas HTTP

O serviço é exposto pelas rotas abaixo. Como o serviço não lê o relógio, `agoraMs` e `capturadoEmMs` podem ser enviados no corpo (epoch ms ou ISO); quando omitidos, o servidor usa o relógio de parede. Rotas de comando e de índice não gravam bytes de vídeo.

| Método | Rota | Papel |
| --- | --- | --- |
| `POST` | `/api/monitoramento/sessoes` | Abre uma sessão (`ambiente` obrigatório; `agoraMs`, `duracaoSegmentoMs`, `retencaoPreEventoMs`, `limiarLacunaMs` opcionais). Sessão já em andamento responde `409`. |
| `POST` | `/api/monitoramento/quadros` | Atribui um lote (`quadros: [{ frameId, capturadoEmMs }]`, até 600) e devolve `atribuicoes` + `rejeitados`. Um quadro recusado não impede os demais. |
| `POST` | `/api/monitoramento/sessoes/:id/pausar` | Pausa a sessão informada. |
| `POST` | `/api/monitoramento/sessoes/:id/retomar` | Retoma a sessão pausada. |
| `POST` | `/api/monitoramento/sessoes/:id/encerrar` | Encerra; o intervalo sem quadros não é coberto. |
| `POST` | `/api/monitoramento/sessoes/:id/interromper` | Falha de gravação; aceita `motivo` (`falha` padrão ou `sem_quadros`). |
| `GET` | `/api/monitoramento/sessoes?limit=` | Sessões do índice (mais recente primeiro). |
| `GET` | `/api/monitoramento/sessoes/:id/segmentos?limit=` | Segmentos da sessão, com o segmento vivo sobreposto ao índice. |
| `GET` | `/api/monitoramento/segmentos?inicio=&fim=&limit=` | Segmentos que tocam o intervalo (extremos inclusivos); sem filtros, devolve o índice cronológico. |

A sobreposição do segmento vivo faz a consulta mostrar `quadros` atualizados mesmo antes do fechamento ser persistido. Ela **não** inventa cobertura: o intervalo entre o último quadro e o comando de encerramento continua fora de todos os segmentos. Enviar quadros sem nenhuma sessão iniciada, comandar uma sessão inexistente/divergente ou abrir uma segunda sessão responde `409`; payload inválido responde `400`; falha inesperada responde `500`.

## O que ainda falta (por honestidade)

A Fase 3 do roteiro também pede:

- gravar os bytes em segmentos de 5 minutos, com container/codec e recuperação após falha;
- armazenamento seguro, criptografia e política de retenção dos arquivos;
- interface de sessão (iniciar/pausar/retomar/encerrar) e indicador de gravação;
- recuperar uma sessão que ficou `ativa` no índice após queda do processo;
- associar eventos persistidos aos segmentos (`segmentoId`) e reproduzir o trecho correspondente;
- medição de perda/sobreposição com captura real e falhas de disco.

Até lá, o que está garantido é a **regra** de segmentação, a janela pré-evento, o índice durável e as rotas de consulta, cobertos por testes determinísticos em `tests/monitoramento.test.ts`, `tests/monitoramento-persistencia.test.ts` e `tests/server-monitoramento.test.ts`.

Vídeos com pessoas são dados sensíveis: quando a gravação real for implementada, os arquivos devem ficar **fora do versionamento** sempre que houver pessoas. Ver [`limites.md`](./limites.md) e [`seguranca.md`](./seguranca.md).
