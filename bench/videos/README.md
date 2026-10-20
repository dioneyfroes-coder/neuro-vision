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

```json
{
  "clip": "sala-com-pessoa.mp4",
  "inicio": "2026-10-11T12:00:00.000Z",
  "duracaoMs": 60000,
  "notas": "Pessoa entra pela direita, atravessa a cena e sai pela esquerda.",
  "eventos": [
    { "tipo": "aparicao", "em": 5000, "descricao": "pessoa entra pela direita" },
    { "tipo": "movimento", "em": 20000 },
    { "tipo": "desaparecimento", "em": 40000, "descricao": "pessoa sai" }
  ]
}
```

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `clip` | não | Nome do arquivo de vídeo a que a anotação se refere. |
| `inicio` | não | Instante ISO em que a captura começou. A base dos offsets `em` vem, por precedência: do sidecar `<eventos>.inicio` (gravado por `e2e/webcam.spec.ts`), deste campo, ou do primeiro evento detectado. |
| `duracaoMs` | não | Duração do clipe em ms. Usada no cálculo de falsos positivos por minuto; se ausente, é derivada do intervalo entre os eventos. |
| `notas` | não | Texto livre para contexto. |
| `eventos` | sim | Lista de mudanças esperadas (pode ser vazia, para um clipe sem mudanças). |

Cada evento tem:

- `tipo`: `aparicao`, `desaparecimento`, `movimento`, `mudanca_de_cena`,
  `resumo` ou `qualquer` (casa com qualquer mudança detectada);
- `em`: instante do evento em **ms desde o início da gravação** (`inicio`);
- `descricao` (opcional): texto livre.

## Como a comparação funciona

- Eventos `resumo` (resumo periódico) são **ignorados** por padrão, porque não
  representam uma mudança de cena. Ajuste com `--ignorados resumo,outro`.
- Para cada evento **esperado**, o script procura a detecção de **tipo
  compatível** mais próxima dentro da **tolerância** (`--tolerancia`, padrão
  3000 ms). Cada detecção só pode casar uma vez.
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
