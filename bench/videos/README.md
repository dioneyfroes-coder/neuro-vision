# Conjunto de vídeos anotados (qualidade de eventos)

Este diretório guarda o **conjunto de vídeos curtos e anotados** usado para medir
a qualidade dos eventos do modo **Eventos** (precisão, recall, mudanças perdidas
e falsos positivos por minuto) de forma **comparável entre execuções**.

O vídeo binário **não é versionado** (ver `.gitignore`): ele fica só na sua
máquina, porque é grande e pode conter cenas sensíveis. O que é versionado aqui é
a **anotação** (`.json`), que descreve o que *deveria* ser detectado naquele
clipe. Assim qualquer pessoa com o mesmo clipe consegue reproduzir a medição.

A anotação `webcam-mudanca.json` acompanha um clipe real gravado com
`scripts/gravar-webcam.mjs` e serve de modelo. A medição da camada de
política/rastreamento, que não depende de vídeo, roda de forma reproduzível em
`tests/qualidade-eventos.test.ts`.

## Como montar uma medição

### Validar os modelos locais reais

O spec `e2e/local-models.spec.ts` roda YOLOv10, YOLO Pose e MediaPipe no
navegador, sem mock dos modelos e sem depender de um backend multimodal. Ele
confere os arquivos servidos de `modelos/` e `vendor/`, backend/versão,
inferência, keypoints COCO e a saída de 21 landmarks por mão. Por padrão, exige
ao menos uma mão detectada; use um clipe curto com uma pessoa e a mão claramente
visível.

```powershell
$env:E2E_LOCAL_MODELS_CLIP = "bench\videos\clipe-com-pessoa-e-mao.mp4"
$env:E2E_LOCAL_MODELS_CHANNEL = "chrome" # opcional: Chrome instalado/WebGPU
npx playwright test e2e/local-models.spec.ts --workers=1
```

O teste fica desativado sem `E2E_LOCAL_MODELS_CLIP`. Para um clipe destinado a
validar apenas detecção/pose e inferência de mãos sem uma mão visível, defina
`E2E_LOCAL_MODELS_REQUIRE_HAND=0`; nesse caso, o teste ainda valida 21 landmarks
para toda mão que o modelo detectar, mas não prova que o modelo os emitiu.
Quando executado, também verifica que os workers da aplicação são encerrados ao
parar a sessão. Pesos e bibliotecas locais são necessários; prepare-os com
`npm run preparar:offline`.

1. Grave um clipe **curto** (10–60 s) com uma única mudança clara por vez — por
   exemplo, uma pessoa entrando e saindo de um escritório:

   ```bash
   npm run gravar:webcam -- bench/videos/webcam-mudanca.webm 30
   ```

2. Anote quando cada evento acontece. Para conferir o conteúdo, extraia quadros:

   ```bash
   npm run extrair:frames -- bench/videos/webcam-mudanca.webm bench/videos/frames 1,5,10,15,20,25
   ```

   Crie `bench/videos/<nome-do-clipe>.json` seguindo o formato abaixo.

3. Reproduza o clipe **para o app com o modelo real** (sem stubs), no modo
   Detecção/Eventos, e capture os eventos. O spec `e2e/webcam.spec.ts` faz isso:
   usa o clipe como "câmera", roda a inferência de verdade e salva os eventos
   gravados (`POST /api/eventos`) em JSONL, além de um sidecar com o instante em
   que o clipe começou a tocar:

   ```text
   E2E_WEBCAM_CLIP=bench/videos/webcam-mudanca.webm
   E2E_WEBCAM_CHANNEL=chrome          # usa o Chrome instalado (WebGPU); sem ele, WASM/CPU
   E2E_WEBCAM_EVENTOS=logs/webcam-eventos.jsonl
   ```

   ```bash
   npx playwright test e2e/webcam.spec.ts --workers=1
   ```

   O modelo real é pesado (ver `bench/BASELINE.md`): em WASM/CPU leva ~24 s por
   inferência e, com WebGPU, ~5–6 s. A cadência de amostragem resultante define a
   tolerância natural da comparação.

4. Compare o que foi gravado com o que foi anotado:

   ```bash
   npm run qualidade -- --anotacao bench/videos/webcam-mudanca.json --eventos logs/webcam-eventos.jsonl --tolerancia 8000
   ```

   Use `--json` para saída legível por máquina e ajuste `--tolerancia` (ms) à
   cadência de amostragem. O sidecar `<eventos>.inicio` é lido automaticamente
   como base dos offsets `em`, então a anotação não precisa de `inicio` fixo.

## Formato da anotação

Anotações legadas continuam aceitas. Para o conjunto reservado, use a versão 2
e mantenha a anotação junto do split correspondente (`bench/clipes/tuning` ou
`bench/clipes/eval`):

```json
{
  "versaoEsquema": 2,
  "clip": "sala-com-pessoa.mp4",
  "conjunto": "eval",
  "inicio": "2026-10-11T12:00:00.000Z",
  "duracaoMs": 60000,
  "revisao": { "status": "revisada", "metodo": "quadro-a-quadro" },
  "negativos": [],
  "notas": "Pessoa entra pela direita, atravessa a cena e sai pela esquerda.",
  "eventos": [
    {
      "tipo": "movimento",
      "em": 20000,
      "inicioMs": 15000,
      "fimMs": 25000,
      "categoria": "gesto",
      "classe": "aceno",
      "visibilidade": "clara",
      "parteEnvolvida": "mao_direita",
      "determinavel": true,
      "descricao": "pessoa acena"
    }
  ]
}
```

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `versaoEsquema` | recomendado | Use `2` para anotações revisadas com os metadados desta fase. |
| `clip` | não | Nome do arquivo de vídeo a que a anotação se refere. |
| `conjunto` | recomendado | `tuning` ou `eval`; nunca use a mesma gravação nos dois splits. |
| `inicio` | não | Instante ISO em que a captura começou. A base dos offsets `em` vem, por precedência: do sidecar `<eventos>.inicio` (gravado por `e2e/webcam.spec.ts`), deste campo, ou do primeiro evento detectado. |
| `duracaoMs` | não | Duração do clipe em ms. Usada no cálculo de falsos positivos por minuto; se ausente, é derivada do intervalo entre os eventos. |
| `revisao` | recomendado | Estado e método da revisão humana; `rascunho` nunca é verdade-base final. |
| `casoNegativo` | opcional | Declare `true` somente se o clipe inteiro não contém nenhum dos eventos-alvo do manifesto. |
| `negativos` | opcional | Lista de alvos ausentes neste clipe, no formato `categoria.classe`; permite negativos por classe mesmo quando há eventos de outras classes. |
| `notas` | não | Texto livre para contexto. |
| `eventos` | sim | Lista de mudanças esperadas (pode ser vazia, para um clipe sem mudanças). |

Cada evento tem:

- `tipo`: `aparicao`, `desaparecimento`, `movimento`, `mudanca_de_cena`,
  `resumo` ou `qualquer` (casa com qualquer mudança detectada);
- `em`: instante do evento em **ms desde o início da gravação** (`inicio`);
- `inicioMs` / `fimMs`: limites do evento, em ms desde o início; `em` continua
  sendo o ponto usado pela comparação de precisão/recall;
- `categoria`: `gesto`, `postura`, `movimento_corporal`, `movimento_objeto`,
  `aparicao_desaparecimento` ou `interpretacao_textual`;
- `classe`: rótulo específico, como `aceno`, `caminhando` ou `pessoa_entrando`;
- `visibilidade`: `clara`, `parcial`, `ocluida` ou
  `impossivel_de_determinar`;
- `parteEnvolvida`: mão, braço, tronco, corpo inteiro, objeto ou
  `indeterminado`;
- `determinavel`: use `false` para eventos que não podem ser julgados com
  segurança; eles são contabilizados à parte e excluídos de precisão/recall;
- `descricao` (opcional): texto livre.

O conjunto EVAL exige revisão humana e intervalos conferidos no vídeo. Um
clipe sem eventos precisa declarar `casoNegativo: true` ou pelo menos um alvo
em `negativos`; um rascunho vazio não comprova ausência de eventos. Use
`casoNegativo` apenas para negativos globais. Consulte a matriz para saber o
escopo e os mínimos vigentes.

No escopo atual de movimento de objetos, a qualidade considera apenas eventos
`movimento` com `origensSinal` contendo `objetos` e `rotuloObjeto` do detector
preenchido e diferente de `person`/`pessoa`. Sem esses campos, o evento não
comprova nem refuta deslocamento de objeto.

## Como a comparação funciona

- Eventos `resumo` (resumo periódico) são **ignorados** por padrão, porque não
  representam uma mudança de cena. Ajuste com `--ignorados resumo,outro`.
- Para cada evento **esperado**, o script procura a detecção de **tipo
  compatível** mais próxima dentro da **tolerância** (`--tolerancia`, padrão
  3000 ms). Cada detecção só pode casar uma vez.
- No escopo EVAL atual, apenas o alvo `movimento_objeto.objeto_deslocado` é
  comparado; movimentos de pessoas e eventos sem rótulo do detector ficam fora
  da métrica desse alvo.
- Detecção que não casa com nenhum evento esperado conta como **falso positivo**.
- Evento esperado sem detecção correspondente conta como **mudança perdida**.
- `--offset <ms>` desloca as detecções em relação à anotação, útil quando o
  início da gravação não bate exatamente com `inicio`.

O script imprime **precisão** (`VP / (VP + FP)`), **recall** (`VP / (VP + FN)`),
a **proporção de mudanças perdidas** e os **falsos positivos por minuto**. Com
`--json`, todos os detalhes (inclusive cada casamento e cada perda) saem
estruturados para comparação entre execuções e hardware.

## Medição registrada

Clipe `webcam-mudanca.webm` (640×480, ~30 s): a pessoa fica no quadro do início
até ~19,5 s e sai (`webcam-mudanca.json`). Com 4 análises via WebGPU, o resultado
foi **precisão 25% · recall 100% · ~6 falsos positivos/min** — a saída foi
detectada ~3,4 s depois do instante real (latência de amostragem), e os falsos
positivos foram rótulos instáveis do detector (`gravata`, `forno`) e uma
`mudanca_de_cena` espúria. Os números completos e as medições de CPU/GPU estão em
`bench/BASELINE.md`.

## Metas

As metas realistas por hardware estão em `bench/BASELINE.md` (com as
especificações da máquina de referência e como recapturá-las). Ajuste-as lá
conforme o hardware muda, **antes** de otimizar.

## Limitações conhecidas

A medição só é tão boa quanto a anotação e os clipes. Cenas com oclusão,
iluminação ruim, classes fora do COCO, alucinações do modelo de visão e
identificação incerta de objetos tendem a gerar falsos positivos e mudanças
perdidas independentemente do código; ver a seção "Limitações conhecidas" do
`README.md`.
