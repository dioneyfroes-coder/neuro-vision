# Modos, motores e modelos — Neuro Vision

Como os modos funcionam (4 de frame único + 3 multiframe do benchmark das Etapas 9–10) e como o modelo é escolhido (detecção no navegador + descrição em um backend de visão local compatível com a API de chat completions — LM Studio, llama.cpp ou vLLM).

## Modos

| Motor | Onde roda | O que faz |
| --- | --- | --- |
| **Detecção** (YOLO em ONNX) | Navegador (WASM) | Detecta objetos (pessoa, carro, celular, ...) com caixas e confiança, usando YOLOv10 (COCO) via `onnxruntime-web`. |
| **Roteiro** (modelo de visão) | Servidor (backend de visão) | Faz **uma análise profunda da cena** (base) e, a cada novo frame, registra **apenas o que mudou** em relação ao que já aconteceu — montando um roteiro cronológico. |
| **Descrição** (modelo de visão) | Servidor (backend de visão) | Descreve cada frame em português, do zero (sem reenviar a descrição anterior). |
| **Eventos** (leve + modelo de visão sob demanda) | Navegador + servidor | Roda a detecção a cada tick e só chama o modelo de visão quando a **política de eventos** decide: mudança de cena, nova entidade, desaparecimento, movimento, baixa confiança, resumo periódico ou pedido manual — com cooldown e teto de chamadas por minuto. Detalhes em [`eventos.md`](./eventos.md). |
| **Percepção sequência** (`percepcao-sequencia`) | Navegador + servidor | Variante **B**: captura 4 frames (500 ms entre eles) e envia só a sequência de imagens ao modelo de visão — sem percepção local nem temporal. Mede o valor do contexto entre imagens. |
| **Percepção fundida** (`percepcao-fundida`) | Navegador + servidor | Variante **C**: os mesmos 4 frames com dados locais estruturados (YOLO + pose + mãos) e leitura temporal **básica** (objetos/cena, sem gestos). |
| **Percepção** (`percepcao`, padrão) | Navegador + servidor | Variante **D** (arquitetura-alvo): 4 frames + todos os dados locais (YOLO, pose, mãos) + motor temporal **ampliado** (gestos, pose, máquina de estados). |

Nos modos multiframe (B/C/D), a chamada multimodal segue a **política do ciclo** (`public/cycle/politica-ciclo.ts`) — por padrão `a_cada_ciclo`; `sob_demanda` e `quando_evento_relevante` suprimem a chamada sem evento relevante, com o motivo em `metricas.interpretacaoSuprimida`. Esses modos **não** passam pela política de eventos (cooldown/teto). O agendador respeita `max(intervalo, duração da análise anterior + 500 ms, pausaAposCiclo)` — a pausa padrão de 6 s é contada do **fim efetivo** do ciclo, não do início; enquanto a chamada está em voo, nenhum ciclo novo avança. O intervalo do seletor não encurta um ciclo já em andamento.

A percepção local dos modos C/D tenta **YOLO, pose e mãos** por padrão (`HABILITACAO_PADRAO`, com `MODELOS_PERCEPCAO_PADRAO`). A habilitação é **explícita** por subsistema (`HabilitacaoSubsistemas`: `deteccao`, `pose`, `maos`, `nsfw`): um subsistema desligado não toca o SDK e responde `indisponivel` ("desativado") em cada frame. A variante B desliga todos. Se um subsistema habilitado não carregar, o ciclo continua e ele aparece em `subsistemasIndisponiveis`. O carregamento é idempotente, o encerramento libera recursos de verdade (trocar de modelo encerra o anterior) e cada subsistema publica telemetria (`modelo`, `dispositivo`, `versao`, `status`, `motivoFalha`, tempos), replicada por frame. As mãos/gestos incluem **fallback GPU→CPU** (`delegate` GPU com timeout e retomada em CPU).

O contexto enviado ao modelo é um JSON **versionado** (`contexto-1`, ver `docs/arquitetura.md` → *Contexto multimodal*): caixas normalizadas e score por detecção, keypoints corporais nomeados, mãos com lateralidade/gesto/landmarks compactos, movimento entre frames e o estado de cada subsistema — com `frameId`, timestamp e versão em cada registro. A variante B envia só imagens e cronologia.

A troca de motor é centralizada em `public/modos.ts` (registro `MODOS`): cada modo descreve se usa detecção/modelo de visão, o prefixo da mensagem de falha e a fábrica de motor — o resto da aplicação não tem `if (modo === "...")` espalhado. O `<select id="motor">` abre em **Percepção** (primeira opção) e `MODO_PADRAO = "percepcao"` é o padrão — as variantes B/C continuam registradas em `MODOS` só para o harness de benchmark/E2E. O seletor `#model` é o do **modelo de detecção do navegador** (abaixo); o `#modeloVisao` é o do **backend de visão** (seção seguinte).

## Backend de visão

O app fala **um único protocolo**, a API de "chat completions":

- `POST /v1/chat/completions` para gerar a descrição;
- `GET /v1/models` para listar os modelos instalados.

É o protocolo exposto pelo **LM Studio**, pelo llama.cpp (`llama-server`) e pelo vLLM. A URL base vem de `NEURO_BASE_URL` (padrão `http://localhost:1234`, a porta do LM Studio) e `NEURO_API_KEY` é enviada como `Authorization: Bearer` (o LM Studio ignora). Se o backend não expuser `/api/v0/models` (introspecção do LM Studio), a confirmação de "modelo em memória" é simplesmente ignorada — o app continua funcionando. A imagem vai como `image_url` (data URL); se a versão do backend rejeitar data URL, defina `NEURO_IMG_BASE64_CRU=1` para enviar base64 cru.

## Escolha do modelo do backend de visão

O app usa **um modelo de visão por vez**. A escolha pode vir de dois lugares:

- **Seletor "Modelo de visão" (`#modeloVisao`) na interface:** lista os modelos instalados no backend (`GET /api/health`), fica salvo no navegador (localStorage) e é enviado em cada análise (`POST /api/visao`) e no preparo (`GET /api/visao/preparar?modelo=...`). Permite alternar entre modelos (ex.: `qwen2.5-vl-3b-instruct` × `gemma-4-e2b-...`) sem reiniciar o servidor. Com ele em "Padrão do servidor", vale o ambiente. O seletor fica bloqueado durante a captura (como os demais): pare, escolha e inicie de novo — a troca carrega o novo modelo na próxima análise.
- **Variável `NEURO_MODEL`** (ex.: `NEURO_MODEL=Qwen2.5-VL-7B-Instruct npm start`), usada quando o seletor está em "Padrão do servidor". Use exatamente o id mostrado em `GET /v1/models`.
- **Padrão:** `qwen2.5-vl-3b-instruct` (`MODELO_PADRAO` em `src/visao.ts`), quando nem o seletor nem o ambiente definem um modelo.
- **Fallback automático:** se o modelo configurado **não estiver disponível**, o app escolhe o melhor encontrado (`melhorModeloDisponivel`), na ordem de `PREFERENCIA_MODELOS` — modelos de visão capazes primeiro (`qwen2.5-vl`, `qwen2.5vl`, `qwen3-vl`, `qwen2-vl`, `llama-3.2-vision`, `minicpm-v`, `gemma-4`, `llava`, ...). Sem backend acessível, mantém o configurado.
- **Requisito:** modelo **multimodal (visão)**. Modelos de **raciocínio** ("thinking") também funcionam: o app ignora `reasoning_content` e usa apenas o `content` final. O seletor da interface esconde modelos claramente de **embedding** (nome com `embed`), que não respondem a imagens.

> **Nota sobre modelos "thinking":** modelos como o `qwen3-vl` ou o `gemma-4`
> primeiro geram ~200–300 tokens de raciocínio e só depois escrevem a resposta.
> O teto de geração
> (`NUM_PREDICT_PADRAO = 768` em `src/visao.ts`) é dimensionado para caber
> raciocínio **e** resposta; é um *teto*, não uma meta — modelos que terminam
> antes param no fim de frase e não pagam nada por ele. O custo real do
> raciocínio é **tempo**: numa mesma máquina o gemma fecha uma análise em ~7 s
> contra ~0,7 s do qwen2.5-vl (medido em `bench/comparativo-2026-10-15.md`).
> Se o teto ainda for consumido inteiramente pelo raciocínio, o servidor devolve
> `502` apontando o limite de tokens (`finish_reason: "length"`) e sugere
> aumentar o teto ou usar um modelo não-pensante. Um modelo de texto puro (sem
> visão) não serve. A tradução automática da saída é **desligada por padrão**
> (`NEURO_TRANSLATE_ENABLED=false`): com um modelo capaz, a descrição já sai em
> português.

A linha de diagnóstico mostra o **backend em uso** (`LM Studio`), o **modelo em uso** (o escolhido no seletor, o `NEURO_MODEL`/padrão, ou o substituto) e os **modelos carregados** — via `GET /api/health`, que lista o que está instalado (`/v1/models`), informa o `solicitado` e o `modelo` efetivo e, quando o backend permite (`/api/v0/models`), o que está em memória. Quando há substituição, a linha indica `fallback de <solicitado>`.

## Modelos de detecção (navegador)

O seletor `#model` da interface oferece modelos COCO em ONNX (YOLOv10, saída NMS-free), carregados do Hugging Face e executados no navegador com `onnxruntime-web` (WASM):

- `onnx-community/yolov10n` — nano, rápido (default).
- `onnx-community/yolov10s` — small, mais preciso, mais pesado.

O runtime e baixado sob demanda do CDN (versão fixada em `1.21.0`); a verificação empírica do caminho completo (pré-processamento, inferência e coordenadas) vive em `scripts/verificar-yolo-onnx.mjs`.

### Validação visual de caixas e keypoints (browser-only)

Os contratos de geometria são cobertos por testes determinísticos em CI
(`tests/yolo-onnx.test.ts` para caixas do YOLO; `tests/percepcao-contratos.test.ts`
para keypoints de pose — bordas, valores fora do frame, dimensões degeneradas).
A validação **visual** com imagens fixas roda só num navegador com rede (não em
CI) e serve para conferir o alinhamento sobre a imagem real:

1. Separe um conjunto fixo de frames (ex.: `bench/videos/frames/frame-*.jpg`, gerados por `node scripts/extrair-frames.mjs`).
2. **YOLO:** `node scripts/verificar-yolo-onnx.mjs <frame.jpg> [limiar]` — roda o caminho real em WASM no Chromium e falha se alguma caixa sair dos limites do frame ou se a pessoa anotada não for encontrada.
3. **Pose:** abra um modo multiframe (C/D) no navegador com o frame fixo, deixe a sessão rodar e confira no diagnóstico a telemetria por subsistema (`metricas.subsistemas.pose`: `status`, `modelo`, `dispositivo`); sobreponha mentalmente os keypoints ao frame para checar o alinhamento (nariz, ombros, punhos).
4. **Mãos:** com o mesmo frame, confirme a telemetria `metricas.subsistemas.maos` (o campo `dispositivo` mostra se o fallback caiu para `cpu`).

O passo é conferência manual: o resultado esperado é caixas dentro do frame e
keypoints coerentes com a pose; divergência indica regressão de
pré/pós-processamento, coberta pelos testes determinísticos.

## NSFW experimental (toggle da interface)

O checkbox **NSFW (experimental)** (`#nsfw`) liga um quarto subsistema do pipeline local: um classificador YOLO treinado para conteúdo sensível (mesmo runtime `onnxruntime-web`/WASM e mesma sessão compartilhada do detector COCO). Com o toggle ligado **na inicialização da sessão**, cada frame ganha marcações (`rotulo`, `score`, `caixa`) que:

- entram no **contexto estruturado enviado ao modelo de visão** (campo `nsfw` do frame no schema `contexto-1`) — somente quando o toggle está ligado e os dados locais vão ao multimodal (variantes C/D); com o toggle desligado o campo é omitido por completo;
- aparecem no diagnóstico por ciclo (`observacoes[].nsfw`, métrica `nsfwMs`, `subsistemasIndisponiveis`).

Detalhes:

- **Pesos locais, nunca commitados.** Os `.pt` vivem em `modelos/yolonsfw/` (gitignored) e são exportados para ONNX por `node scripts/exportar-yolo-nsfw.mjs` (requer `ultralytics` — venv sugerida em `modelos/yolonsfw/.venv`). O servidor expõe os arquivos em `/yolonsfw/` (`src/server.ts`); sem export, a carga falha com instrução de como gerar.
- **Rótulos do próprio modelo.** O export grava o sidecar `<modelo>.onnx.json` com as classes (no erax: `anus`, `make_love`, `nipple`, `penis`, `vagina`); o cliente lê o sidecar em vez de duplicar a tabela.
- **Desligado por padrão e experimental.** Sem toggle, nada é carregado e o `nsfw` fica ausente nas observações (a distinção "não rodou" × "rodou e não marcou" é preservada). O toggle fica bloqueado durante a captura (como os seletores de motor): ele vale para a próxima inicialização de sessão.
- **Verificação empírica:** `node scripts/verificar-yolo-nsfw.mjs [modelo] [frame] [limiar]` — roda o caminho real em WASM no Chromium sobre frames de `bench/videos/frames/` (~0,8 s por inferência com o nano, saída `1×300×6`, NMS embutido no export).

## Repetição na descrição

O motor de descrição costumava repetir/fundir frases. As causas eram do próprio modelo, agravadas por reinjetar a descrição anterior inteira. Mitigações atuais: cada frame é descrito **do zero** (a descrição anterior não é reenviada), amostragem com `temperature: 0.2`, `top_p: 0.9`, `max_tokens` reduzido no delta do roteiro (`NUM_PREDICT_DELTA`) e pós-processamento (`colapsarRepeticoes` + `cortarFraseIncompleta`) no servidor.