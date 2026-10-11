# Conjunto de vídeos anotados (qualidade de eventos)

Este diretório guarda o **conjunto de vídeos curtos e anotados** usado para medir
a qualidade dos eventos do modo **Eventos** (precisão, recall, mudanças perdidas
e falsos positivos por minuto) de forma **comparável entre execuções**.

O vídeo binário **não é versionado** (ver `.gitignore`): ele fica só na sua
máquina, porque é grande e pode conter cenas sensíveis. O que é versionado aqui é
a **anotação** (`.json`), que descreve o que *deveria* ser detectado naquele
clipe. Assim qualquer pessoa com o mesmo clipe consegue reproduzir a medição.

O conjunto com clipes reais reais ainda **não foi incluído** — este diretório
documenta o formato e traz um exemplo (`exemplo-anotacao.json`) para quando eles
existirem. A medição da camada de política/rastreamento, que não depende de
vídeo, já roda de forma reproduzível em `src/qualidade-eventos.test.ts`.

## Como montar uma medição

1. Grave (ou baixe) um clipe **curto** (10–60 s) com uma única mudança clara por
   vez — por exemplo, uma pessoa entrando e saindo de um escritório.
2. Coloque o clipe em `bench/videos/` (pode ser `.mp4`, `.webm` ou `.mkv`).
3. Crie `bench/videos/<nome-do-clipe>.json` seguindo o formato abaixo,
   anotando quando cada evento acontece.
4. Rode o app sobre o clipe pelo tempo do clipe, no modo **Eventos**
   (`npm start`), e deixe os eventos serem gravados em `logs/eventos.jsonl`.
   Limpe esse arquivo antes de começar (`logs/*.jsonl` não é versionado).
5. Compare o que foi gravado com o que foi anotado:

   ```bash
   npm run qualidade -- --anotacao bench/videos/<nome-do-clipe>.json
   ```

   Use `--json` para saída legível por máquina e `--tolerancia 3000` para
   ajustar a janela de casamento em milissegundos.

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
| `inicio` | não | Instante ISO em que a captura começou. Alinha os eventos gravados com a anotação. Se ausente, usa o primeiro evento detectado como base. |
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
