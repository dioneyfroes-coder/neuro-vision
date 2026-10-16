# Estado inicial - Fase 0
Data: 2026-10-12 23:11:29
Branch: fix/percepcao-temporal
Commit: e55aeef

> **Como ler este documento (papel histórico).** Este é o **transcrito bruto** do
> estado da base **antes** das correções de percepção temporal: os erros de
> typecheck, as 32 falhas de teste e a configuração inicial, exatamente como
> saíram na máquina. Ele é a **prova dos problemas** (não das medições de
> qualidade — essas estão em [`bench/comparativo-2026-10-15.md`](./bench/comparativo-2026-10-15.md)).
> As **soluções** de cada problema listado aqui foram aplicadas no histórico de
> commits seguinte a esta data (o documento de correções que as descrevia foi
> removido); as metas/medições atuais estão em `bench/BASELINE.md` e o estado
> congelado antes da modularização está em
> [`bench/baseline-modularizacao-2026-10-16.json`](./bench/baseline-modularizacao-2026-10-16.json). O texto abaixo é o registro original, **sem
> alterações** — menciona `src/ollama.ts`, `ErroOllama` e afins porque esse era o
> estado do repositório na data (a camada Ollama foi removida depois; ver
> `docs/modos.md`).

## Dependencias
Lockfile presente: True

## Verificacoes iniciais

src/ollama.test.ts(43,34): error TS2554: Expected 0 arguments, but got 1.
src/ollama.test.ts(47,42): error TS2554: Expected 0 arguments, but got 1.
src/ollama.ts(432,98): error TS2554: Expected 0 arguments, but got 1.
src/ollama.ts(432,105): error TS2339: Property 'anterior' does not exist on type 'OpcoesGerarDescricao'.

---SEPARATOR---
src/ollama.test.ts(43,34): error TS2554: Expected 0 arguments, but got 1.
src/ollama.test.ts(47,42): error TS2554: Expected 0 arguments, but got 1.
src/ollama.ts(432,98): error TS2554: Expected 0 arguments, but got 1.
src/ollama.ts(432,105): error TS2339: Property 'anterior' does not exist on type 'OpcoesGerarDescricao'.
---TS_END---

> neuro-vision@0.1.0 lint
> eslint .

---LINT_END---

[1m[30m[46m RUN [49m[39m[22m [36mv5.0.3 [39m[90mC:/Users/dratz/OneDrive/Documentos/workspace/neuro[39m

node.exe : [90mstderr[2m | src/server.test.ts[2m > [22m[2mcreateServer[2m > [22m[2mPOST /api/visao descreve 
via Ollama (streaming mock) e grava log
No linha:1 caractere:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: ([90mstderr[2m...ck) e grava log:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
[22m[39m{"ts":"2026-10-13T02:12:20.843Z","nivel":"error","evento":"visao_falhou","status":502,"erro":"fetch 
failed","timeout":false}

[90mstderr[2m | src/server.test.ts[2m > [22m[2mcreateServer[2m > [22m[2mPOST /api/visao registra o motivo que 
acionou a analise
[22m[39m{"ts":"2026-10-13T02:12:20.891Z","nivel":"error","evento":"visao_falhou","status":502,"erro":"fetch 
failed","timeout":false}

[90mstderr[2m | src/server.test.ts[2m > [22m[2mcreateServer[2m > [22m[2mPOST /api/visao no modo roteiro grava 
a base e colapsa repeticoes nos deltas
[22m[39m{"ts":"2026-10-13T02:12:20.923Z","nivel":"error","evento":"visao_falhou","status":502,"erro":"fetch 
failed","timeout":false}

 [31mÔØ»[39m src/ollama.test.ts [2m([22m[2m52 tests[22m[2m | [22m[31m18 failed[39m[2m)[22m[33m 5159[2mms[22m[39m
   [31mÔØ»[39m montarPromptDescricao [2m(2)[22m
[31m     [31m%ù[31m inclui a descricao anterior e pede detalhes em vez de repetir[39m[32m 29[2mms[22m[39m
   [31mÔØ»[39m gerarDescricao [2m(3)[22m
[31m     [31m%ù[31m envia a requisicao correta e devolve a descricao[39m[32m 8[2mms[22m[39m
[31m     [31m%ù[31m lan%ºa erro quando o modelo derivou sem responder (thinking)[39m[32m 7[2mms[22m[39m
   [31mÔØ»[39m gerarDescricaoStream [2m(6)[22m
[31m     [31m%ù[31m emite os pedacos da resposta e o resumo final[39m[32m 47[2mms[22m[39m
[31m     [31m%ù[31m lan%ºa erro quando o modelo so deriva (thinking) sem emitir texto[39m[32m 2[2mms[22m[39m
[31m     [31m%ù[31m lan%ºa erro quando o stream emite um evento de erro[39m[32m 2[2mms[22m[39m
   [31mÔØ»[39m modelosEmMemoria [2m(2)[22m
[31m     [31m%ù[31m lista os modelos que estao na memoria via /api/ps[39m[32m 5[2mms[22m[39m
   [31mÔØ»[39m modelosInstalados [2m(2)[22m
[31m     [31m%ù[31m lista os modelos via /api/tags[39m[32m 1[2mms[22m[39m
   [31mÔØ»[39m escolherModelo [2m(5)[22m
[31m     [31m%ù[31m usa o melhor disponivel quando o padrao falta[39m[32m 2[2mms[22m[39m
   [31mÔØ»[39m modeloEmMemoria [2m(4)[22m
[31m     [31m%ù[31m confirma apenas o modelo solicitado quando o /api/ps usa name[39m[32m 1[2mms[22m[39m
[31m     [31m%ù[31m aceita os nomes retornados por /api/ps no campo model[39m[32m 1[2mms[22m[39m
[31m     [31m%ù[31m equipara nome sem tag a latest em /api/ps[39m[32m 1[2mms[22m[39m
   [31mÔØ»[39m forcarCarregamento [2m(4)[22m
[31m     [31m%ù[31m nao chama o generate quando o modelo ja esta em memoria[39m[33m 5012[2mms[22m[39m
[31m     [31m%ù[31m carrega o modelo quando nao esta em memoria e espera o /api/ps confirma-lo[39m[32m 1[2mms[22m[39m
[31m     [31m%ù[31m lanca erro quando a carga falha[39m[32m 1[2mms[22m[39m
   [31mÔØ»[39m montarPromptRoteiro [2m(3)[22m
[31m     [31m%ù[31m usado em delta embute o roteiro acumulado[39m[32m 2[2mms[22m[39m
   [31mÔØ»[39m gerarDescricao no modo roteiro [2m(2)[22m
[31m     [31m%ù[31m frame base usa num_predict padrao e prompt de base[39m[32m 1[2mms[22m[39m
[31m     [31m%ù[31m delta usa num_predict reduzido e prompt com roteiro[39m[32m 1[2mms[22m[39m
[90mstderr[2m | src/server.test.ts[2m > [22m[2mcreateServer[2m > [22m[2mPOST /api/visao registra 
visao_cancelada quando o cliente desconecta
[22m[39m{"ts":"2026-10-13T02:12:43.615Z","nivel":"error","evento":"visao_falhou","status":502,"erro":"fetch 
failed","timeout":false}

[90mstderr[2m | src/server.test.ts[2m > [22m[2mcreateServer[2m > [22m[2mGET /api/visao/preparar confirma o 
modelo em memoria sem disparar geracao
[22m[39m{"ts":"2026-10-13T02:12:48.626Z","nivel":"error","evento":"modelo_preparacao_falhou","modelo":"qwen2.5-vl-3b-
instruct","erro":"fetch failed"}

[90mstderr[2m | src/server.test.ts[2m > [22m[2mcreateServer[2m > [22m[2mGET /api/visao/preparar nao confunde 
modelos de mesma base com tags diferentes
[22m[39m{"ts":"2026-10-13T02:12:48.659Z","nivel":"error","evento":"modelo_preparacao_falhou","modelo":"qwen2.5-vl-3b-
instruct","erro":"fetch failed"}

 [31mÔØ»[39m src/server.test.ts [2m([22m[2m82 tests[22m[2m | [22m[31m14 failed[39m[2m)[22m[33m 28316[2mms[22m[39m
   [31mÔØ»[39m createServer [2m(30)[22m
[31m     [31m%ù[31m POST /api/visao descreve via Ollama (streaming mock) e grava log[39m[32m 84[2mms[22m[39m
[31m     [31m%ù[31m POST /api/visao registra o motivo que acionou a analise[39m[32m 26[2mms[22m[39m
[31m     [31m%ù[31m POST /api/visao no modo roteiro grava a base e colapsa repeticoes nos deltas[39m[32m 20[2mms[22m[39m
[31m     [31m%ù[31m POST /api/visao com Ollama indisponivel retorna 502[39m[33m 5006[2mms[22m[39m
[31m     [31m%ù[31m POST /api/visao com stream vazio do Ollama retorna 502 e nao grava log[39m[33m 5013[2mms[22m[39m
[31m     [31m%ù[31m POST /api/visao com modelo always-thinking retorna 502 com orientacao[39m[33m 5014[2mms[22m[39m
[31m     [31m%ù[31m POST /api/visao com evento de erro do Ollama retorna 502 e nao grava log[39m[33m 5016[2mms[22m[39m
[31m     [31m%ù[31m GET /api/health informa o status do Ollama[39m[32m 16[2mms[22m[39m
[31m     [31m%ù[31m GET /api/health troca pelo melhor modelo quando o padrao nao esta instalado[39m[32m 16[2mms[22m[39m
[31m     [31m%ù[31m GET /api/health reporta Ollama offline quando falha[39m[32m 20[2mms[22m[39m
[31m     [31m%ù[31m GET /api/health lista os modelos que estao em memoria[39m[32m 14[2mms[22m[39m
[31m     [31m%ù[31m POST /api/visao registra visao_cancelada quando o cliente desconecta[39m[33m 5007[2mms[22m[39m
[31m     [31m%ù[31m GET /api/visao/preparar confirma o modelo em memoria sem disparar geracao[39m[32m 22[2mms[22m[39m
[31m     [31m%ù[31m GET /api/visao/preparar nao confunde modelos de mesma base com tags diferentes[39m[32m 22[2mms[22m[39m

[31mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[39m[1m[41m Failed Tests 32 [49m[22m[31mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[39m

[41m[1m FAIL [22m[49m src/ollama.test.ts[2m > [22mmontarPromptDescricao[2m > [22minclui a descricao anterior e 
pede detalhes em vez de repetir
[31m[1mAssertionError[22m: expected 'Voce observa UMA foto da webcam, tiraÔÇª' to contain 'Uma pessoa sentada'[39m

Expected: [32m"Uma pessoa sentada"[39m
Received: [31m"Voce observa UMA foto da webcam, tirada agora. Descreva objetivamente o que aparece NESTA imagem: 
pessoas, objetos (inclusive o que estiver sendo segurado ou mostrado), cores, postura e disposicao. Baseie-se somente 
no que ve na imagem; nao cite fotos, descricoes ou momentos anteriores. Responda em portugues, no maximo 2 
frases."[39m

[36m [2mÔØ»[22m src/ollama.test.ts:[2m48:20[22m[39m
    [90m 46|[39m   it("inclui a descricao anterior e pede detalhes em vez de repetir", ÔÇª
    [90m 47|[39m     const prompt = montarPromptDescricao("Uma pessoa sentada.");
    [90m 48|[39m     expect(prompt).toContain("Uma pessoa sentada");
    [90m   |[39m                    [31m^[39m
    [90m 49|[39m     expect(prompt).toContain("NAO repita");
    [90m 50|[39m     expect(prompt).toContain("detalhes adicionais");

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[1/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/ollama.test.ts[2m > [22mgerarDescricao[2m > [22menvia a requisicao correta e devolve 
a descricao
[31m[1mErroOllama[22m: o modelo qwen3-vl:4b nao retornou nenhum token de texto. Verifique se o modelo carregado no 
LM Studio aceita imagens (e o `max_tokens`).[39m
[36m [2mÔØ»[22m lancarSeVazioSemResposta src/ollama.ts:[2m470:9[22m[39m
    [90m468|[39m       ? "Verifique se o modelo carregado no LM Studio aceita imagens (ÔÇª
    [90m469|[39m       : "Verifique think/num_predict e se o modelo suporta visao.";
    [90m470|[39m   throw new ErroOllama(`o modelo ${modelo} nao retornou nenhum token dÔÇª
    [90m   |[39m         [31m^[39m
    [90m471|[39m }
    [90m472|[39m
[90m [2mÔØ»[22m gerarDescricao src/ollama.ts:[2m497:15[22m[39m
[90m [2mÔØ»[22m src/ollama.test.ts:[2m68:23[22m[39m

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[2/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/ollama.test.ts[2m > [22mgerarDescricao[2m > [22mlan%ºa erro quando o modelo derivou 
sem responder (thinking)
[31m[1mAssertionError[22m: expected [Function] to throw error matching /derivÔÇª/raciocinou sem produzir resposta 
but got 'o modelo qwen3-vl:4b nao retornou nenÔÇª'[39m

[32m- Expected:[39m
/derivou\/raciocinou sem produzir resposta/

[31m+ Received:[39m
"o modelo qwen3-vl:4b nao retornou nenhum token de texto. Verifique se o modelo carregado no LM Studio aceita imagens 
(e o `max_tokens`)."

[36m [2mÔØ»[22m src/ollama.test.ts:[2m105:68[22m[39m
    [90m103|[39m     );
    [90m104|[39m
    [90m105|[39m     await expect(gerarDescricao("AAAA", { modelo: "qwen3-vl:4b" })).reÔÇª
    [90m   |[39m                                                                    [31m^[39m
    [90m106|[39m       /derivou\/raciocinou sem produzir resposta/
    [90m107|[39m     );

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[3/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/ollama.test.ts[2m > [22mgerarDescricaoStream[2m > [22memite os pedacos da resposta e 
o resumo final
[31m[1mErroOllama[22m: o modelo qwen3-vl:4b nao retornou nenhum token de texto. Verifique se o modelo carregado no 
LM Studio aceita imagens (e o `max_tokens`).[39m
[36m [2mÔØ»[22m lancarSeVazioSemResposta src/ollama.ts:[2m470:9[22m[39m
    [90m468|[39m       ? "Verifique se o modelo carregado no LM Studio aceita imagens (ÔÇª
    [90m469|[39m       : "Verifique think/num_predict e se o modelo suporta visao.";
    [90m470|[39m   throw new ErroOllama(`o modelo ${modelo} nao retornou nenhum token dÔÇª
    [90m   |[39m         [31m^[39m
    [90m471|[39m }
    [90m472|[39m
[90m [2mÔØ»[22m gerarDescricaoStream src/ollama.ts:[2m576:21[22m[39m
[90m [2mÔØ»[22m src/ollama.test.ts:[2m145:21[22m[39m

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[4/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/ollama.test.ts[2m > [22mgerarDescricaoStream[2m > [22mlan%ºa erro quando o modelo so 
deriva (thinking) sem emitir texto
[31m[1mAssertionError[22m: expected [Function] to throw error matching /derivÔÇª/raciocinou sem produzir resposta 
but got 'o modelo qwen3-vl:4b nao retornou nenÔÇª'[39m

[32m- Expected:[39m
/derivou\/raciocinou sem produzir resposta/

[31m+ Received:[39m
"o modelo qwen3-vl:4b nao retornou nenhum token de texto. Verifique se o modelo carregado no LM Studio aceita imagens 
(e o `max_tokens`)."

[36m [2mÔØ»[22m src/ollama.test.ts:[2m164:34[22m[39m
    [90m162|[39m
    [90m163|[39m     const iterator = gerarDescricaoStream("AAAA", { modelo: "qwen3-vl:ÔÇª
    [90m164|[39m     await expect(iterator.next()).rejects.toThrow(/derivou\/raciocinouÔÇª
    [90m   |[39m                                  [31m^[39m
    [90m165|[39m   });
    [90m166|[39m

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[5/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/ollama.test.ts[2m > [22mgerarDescricaoStream[2m > [22mlan%ºa erro quando o stream 
emite um evento de erro
[31m[1mAssertionError[22m: expected [Function] to throw error matching /model not loaded/ but got 'o modelo x nao 
retornou nenhum token ÔÇª'[39m

[32m- Expected:[39m
/model not loaded/

[31m+ Received:[39m
"o modelo x nao retornou nenhum token de texto. Verifique se o modelo carregado no LM Studio aceita imagens (e o 
`max_tokens`)."

[36m [2mÔØ»[22m src/ollama.test.ts:[2m214:34[22m[39m
    [90m212|[39m
    [90m213|[39m     const iterator = gerarDescricaoStream("AAAA", { modelo: "x" });
    [90m214|[39m     await expect(iterator.next()).rejects.toThrow(/model not loaded/);
    [90m   |[39m                                  [31m^[39m
    [90m215|[39m   });
    [90m216|[39m

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[6/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/ollama.test.ts[2m > [22mmodelosEmMemoria[2m > [22mlista os modelos que estao na 
memoria via /api/ps
[31m[1mAssertionError[22m: expected [] to deeply equal [ 'qwen3-vl:4b', 'llama3.2:3b' ][39m

[32m- Expected[39m
[31m+ Received[39m

[32m- [[39m
[32m-   "qwen3-vl:4b",[39m
[32m-   "llama3.2:3b",[39m
[32m- ][39m
[31m+ [][39m

[36m [2mÔØ»[22m src/ollama.test.ts:[2m243:21[22m[39m
    [90m241|[39m
    [90m242|[39m     const memoria = await modelosEmMemoria({ host: "http://localhost:1ÔÇª
    [90m243|[39m     expect(memoria).toEqual(["qwen3-vl:4b", "llama3.2:3b"]);
    [90m   |[39m                     [31m^[39m
    [90m244|[39m   });
    [90m245|[39m

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[7/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/ollama.test.ts[2m > [22mmodelosInstalados[2m > [22mlista os modelos via /api/tags
[31m[1mAssertionError[22m: expected [] to deeply equal [ 'qwen2.5vl:3b', 'llava:7b' ][39m

[32m- Expected[39m
[31m+ Received[39m

[32m- [[39m
[32m-   "qwen2.5vl:3b",[39m
[32m-   "llava:7b",[39m
[32m- ][39m
[31m+ [][39m

[36m [2mÔØ»[22m src/ollama.test.ts:[2m333:72[22m[39m
    [90m331|[39m       })
    [90m332|[39m     );
    [90m333|[39m     await expect(modelosInstalados({ host: "http://localhost:11434" })ÔÇª
    [90m   |[39m                                                                        [31m^[39m
    [90m334|[39m       "qwen2.5vl:3b",
    [90m335|[39m       "llava:7b",

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[8/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/ollama.test.ts[2m > [22mescolherModelo[2m > [22musa o melhor disponivel quando o 
padrao falta
[31m[1mAssertionError[22m: expected { ÔÇª(3) } to deeply equal { ÔÇª(3) }[39m

[32m- Expected[39m
[31m+ Received[39m

[2m  {[22m
[32m-   "alternativo": true,[39m
[32m-   "modelo": "qwen2.5vl:3b",[39m
[31m+   "alternativo": false,[39m
[31m+   "modelo": "qwen2.5-vl-3b-instruct",[39m
[2m    "solicitado": "qwen2.5-vl-3b-instruct",[22m
[2m  }[22m

[36m [2mÔØ»[22m src/ollama.test.ts:[2m380:35[22m[39m
    [90m378|[39m       })
    [90m379|[39m     );
    [90m380|[39m     await expect(escolherModelo()).resolves.toEqual({
    [90m   |[39m                                   [31m^[39m
    [90m381|[39m       solicitado: MODELO_PADRAO,
    [90m382|[39m       modelo: "qwen2.5vl:3b",

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[9/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/ollama.test.ts[2m > [22mmodeloEmMemoria[2m > [22mconfirma apenas o modelo solicitado 
quando o /api/ps usa name
[31m[1mAssertionError[22m: expected false to be true // Object.is equality[39m

[32m- Expected[39m
[31m+ Received[39m

[32m- true[39m
[31m+ false[39m

[36m [2mÔØ»[22m src/ollama.test.ts:[2m418:62[22m[39m
    [90m416|[39m     );
    [90m417|[39m
    [90m418|[39m     await expect(modeloEmMemoria({ modelo: "qwen2.5vl:3b" })).resolvesÔÇª
    [90m   |[39m                                                              [31m^[39m
    [90m419|[39m     await expect(modeloEmMemoria({ modelo: "qwen2.5vl:7b" })).resolvesÔÇª
    [90m420|[39m   });

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[10/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/ollama.test.ts[2m > [22mmodeloEmMemoria[2m > [22maceita os nomes retornados por 
/api/ps no campo model
[31m[1mAssertionError[22m: expected false to be true // Object.is equality[39m

[32m- Expected[39m
[31m+ Received[39m

[32m- true[39m
[31m+ false[39m

[36m [2mÔØ»[22m src/ollama.test.ts:[2m431:62[22m[39m
    [90m429|[39m     );
    [90m430|[39m
    [90m431|[39m     await expect(modeloEmMemoria({ modelo: "qwen2.5vl:3b" })).resolvesÔÇª
    [90m   |[39m                                                              [31m^[39m
    [90m432|[39m   });
    [90m433|[39m

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[11/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/ollama.test.ts[2m > [22mmodeloEmMemoria[2m > [22mequipara nome sem tag a latest em 
/api/ps
[31m[1mAssertionError[22m: expected false to be true // Object.is equality[39m

[32m- Expected[39m
[31m+ Received[39m

[32m- true[39m
[31m+ false[39m

[36m [2mÔØ»[22m src/ollama.test.ts:[2m443:59[22m[39m
    [90m441|[39m     );
    [90m442|[39m
    [90m443|[39m     await expect(modeloEmMemoria({ modelo: "qwen2.5vl" })).resolves.toÔÇª
    [90m   |[39m                                                           [31m^[39m
    [90m444|[39m   });
    [90m445|[39m

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[12/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/ollama.test.ts[2m > [22mforcarCarregamento[2m > [22mnao chama o generate quando o 
modelo ja esta em memoria
[31m[1mError[22m: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with 
"testTimeout".[39m
[36m [2mÔØ»[22m src/ollama.test.ts:[2m457:3[22m[39m
    [90m455|[39m
    [90m456|[39m describe("forcarCarregamento", () => {
    [90m457|[39m   it("nao chama o generate quando o modelo ja esta em memoria", async ÔÇª
    [90m   |[39m   [31m^[39m
    [90m458|[39m     const fetchMock = vi
    [90m459|[39m       .fn()

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[13/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/ollama.test.ts[2m > [22mforcarCarregamento[2m > [22mcarrega o modelo quando nao esta 
em memoria e espera o /api/ps confirma-lo
[31m[1mError[22m: URL inesperada: http://127.0.0.1:1235/v1/chat/completions[39m
[36m [2mÔØ»[22m src/ollama.test.ts:[2m485:13[22m[39m
    [90m483|[39m         return { ok: true, json: async () => ({ message: { content: "oÔÇª
    [90m484|[39m       }
    [90m485|[39m       throw new Error(`URL inesperada: ${url}`);
    [90m   |[39m             [31m^[39m
    [90m486|[39m     });
    [90m487|[39m     vi.stubGlobal("fetch", fetchMock);
[90m [2mÔØ»[22m forcarCarregamento src/ollama.ts:[2m394:26[22m[39m
[90m [2mÔØ»[22m src/ollama.test.ts:[2m489:19[22m[39m

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[14/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/ollama.test.ts[2m > [22mforcarCarregamento[2m > [22mlanca erro quando a carga falha
[31m[1mAssertionError[22m: expected [Function] to throw error matching /404/ but got 'unexpected'[39m

[32m- Expected:[39m
/404/

[31m+ Received:[39m
"unexpected"

[36m [2mÔØ»[22m src/ollama.test.ts:[2m504:54[22m[39m
    [90m502|[39m     vi.stubGlobal("fetch", fetchMock);
    [90m503|[39m
    [90m504|[39m     await expect(forcarCarregamento({ modelo: "x" })).rejects.toThrow(ÔÇª
    [90m   |[39m                                                      [31m^[39m
    [90m505|[39m   });
    [90m506|[39m

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[15/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/ollama.test.ts[2m > [22mmontarPromptRoteiro[2m > [22musado em delta embute o roteiro 
acumulado
[31m[1mAssertionError[22m: expected 'Voce observa UMA foto da webcam, tiraÔÇª' to contain 'Pessoa de pe. Braco 
esquerdo levantadÔÇª'[39m

Expected: [32m"[7mPessoa de pe. Braco esquerdo levantado[27m."[39m
Received: [31m"[7mVoce observa UMA foto da webcam, tirada agora. Em 1 frase curta e concreta, diga o que ha NESTA 
imagem (pessoas, objetos, o que estiver sendo segurado ou mostrado). Baseie-se somente no que ve agora; nao repita nem 
compare com fotos anteriores[27m."[39m

[36m [2mÔØ»[22m src/ollama.test.ts:[2m557:20[22m[39m
    [90m555|[39m     const prompt = montarPromptRoteiro(false, "Pessoa de pe. Braco esqÔÇª
    [90m556|[39m     expect(prompt).toContain(PROMPT_ROTEIRO_DELTA);
    [90m557|[39m     expect(prompt).toContain("Pessoa de pe. Braco esquerdo levantado."ÔÇª
    [90m   |[39m                    [31m^[39m
    [90m558|[39m     expect(prompt).toContain("Roteiro ate agora");
    [90m559|[39m   });

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[16/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/ollama.test.ts[2m > [22mgerarDescricao no modo roteiro[2m > [22mframe base usa 
num_predict padrao e prompt de base
[31m[1mErroOllama[22m: o modelo qwen2.5vl:3b nao retornou nenhum token de texto. Verifique se o modelo carregado no 
LM Studio aceita imagens (e o `max_tokens`).[39m
[36m [2mÔØ»[22m lancarSeVazioSemResposta src/ollama.ts:[2m470:9[22m[39m
    [90m468|[39m       ? "Verifique se o modelo carregado no LM Studio aceita imagens (ÔÇª
    [90m469|[39m       : "Verifique think/num_predict e se o modelo suporta visao.";
    [90m470|[39m   throw new ErroOllama(`o modelo ${modelo} nao retornou nenhum token dÔÇª
    [90m   |[39m         [31m^[39m
    [90m471|[39m }
    [90m472|[39m
[90m [2mÔØ»[22m gerarDescricao src/ollama.ts:[2m497:15[22m[39m
[90m [2mÔØ»[22m src/ollama.test.ts:[2m579:5[22m[39m

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[17/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/ollama.test.ts[2m > [22mgerarDescricao no modo roteiro[2m > [22mdelta usa 
num_predict reduzido e prompt com roteiro
[31m[1mErroOllama[22m: o modelo qwen2.5vl:3b nao retornou nenhum token de texto. Verifique se o modelo carregado no 
LM Studio aceita imagens (e o `max_tokens`).[39m
[36m [2mÔØ»[22m lancarSeVazioSemResposta src/ollama.ts:[2m470:9[22m[39m
    [90m468|[39m       ? "Verifique se o modelo carregado no LM Studio aceita imagens (ÔÇª
    [90m469|[39m       : "Verifique think/num_predict e se o modelo suporta visao.";
    [90m470|[39m   throw new ErroOllama(`o modelo ${modelo} nao retornou nenhum token dÔÇª
    [90m   |[39m         [31m^[39m
    [90m471|[39m }
    [90m472|[39m
[90m [2mÔØ»[22m gerarDescricao src/ollama.ts:[2m497:15[22m[39m
[90m [2mÔØ»[22m src/ollama.test.ts:[2m605:5[22m[39m

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[18/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/server.test.ts[2m > [22mcreateServer[2m > [22mPOST /api/visao descreve via Ollama 
(streaming mock) e grava log
[31m[1mAssertionError[22m: expected 502 to be 200 // Object.is equality[39m

[32m- Expected[39m
[31m+ Received[39m

[32m- 200[39m
[31m+ 502[39m

[36m [2mÔØ»[22m src/server.test.ts:[2m645:26[22m[39m
    [90m643|[39m         }),
    [90m644|[39m       });
    [90m645|[39m       expect(res.status).toBe(200);
    [90m   |[39m                          [31m^[39m
    [90m646|[39m       const eventos = (await res.text())
    [90m647|[39m         .trim()

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[19/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/server.test.ts[2m > [22mcreateServer[2m > [22mPOST /api/visao registra o motivo que 
acionou a analise
[31m[1mAssertionError[22m: expected 502 to be 200 // Object.is equality[39m

[32m- Expected[39m
[31m+ Received[39m

[32m- 200[39m
[31m+ 502[39m

[36m [2mÔØ»[22m src/server.test.ts:[2m718:26[22m[39m
    [90m716|[39m         }),
    [90m717|[39m       });
    [90m718|[39m       expect(res.status).toBe(200);
    [90m   |[39m                          [31m^[39m
    [90m719|[39m       const eventos = (await res.text())
    [90m720|[39m         .trim()

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[20/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/server.test.ts[2m > [22mcreateServer[2m > [22mPOST /api/visao no modo roteiro grava 
a base e colapsa repeticoes nos deltas
[31m[1mAssertionError[22m: expected 502 to be 200 // Object.is equality[39m

[32m- Expected[39m
[31m+ Received[39m

[32m- 200[39m
[31m+ 502[39m

[36m [2mÔØ»[22m src/server.test.ts:[2m801:30[22m[39m
    [90m799|[39m     try {
    [90m800|[39m       const resBase = await post({ imagem: "QkxPQ", modo: "roteiro", bÔÇª
    [90m801|[39m       expect(resBase.status).toBe(200);
    [90m   |[39m                              [31m^[39m
    [90m802|[39m       const eventosBase = (await resBase.text()).trim().split("\n").maÔÇª
    [90m803|[39m       const doneBase = eventosBase.find((e) => e.type === "done");

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[21/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/server.test.ts[2m > [22mcreateServer[2m > [22mPOST /api/visao com Ollama 
indisponivel retorna 502
[31m[1mError[22m: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with 
"testTimeout".[39m
[36m [2mÔØ»[22m src/server.test.ts:[2m862:3[22m[39m
    [90m860|[39m   });
    [90m861|[39m
    [90m862|[39m   it("POST /api/visao com Ollama indisponivel retorna 502", async () =ÔÇª
    [90m   |[39m   [31m^[39m
    [90m863|[39m     vi.stubGlobal(
    [90m864|[39m       "fetch",

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[22/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/server.test.ts[2m > [22mcreateServer[2m > [22mPOST /api/visao com stream vazio do 
Ollama retorna 502 e nao grava log
[31m[1mError[22m: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with 
"testTimeout".[39m
[36m [2mÔØ»[22m src/server.test.ts:[2m890:3[22m[39m
    [90m888|[39m   });
    [90m889|[39m
    [90m890|[39m   it("POST /api/visao com stream vazio do Ollama retorna 502 e nao graÔÇª
    [90m   |[39m   [31m^[39m
    [90m891|[39m     const ndjson = JSON.stringify({ done: true, eval_count: 0 }) + "\nÔÇª
    [90m892|[39m     vi.stubGlobal(

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[23/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/server.test.ts[2m > [22mcreateServer[2m > [22mPOST /api/visao com modelo 
always-thinking retorna 502 com orientacao
[31m[1mError[22m: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with 
"testTimeout".[39m
[36m [2mÔØ»[22m src/server.test.ts:[2m922:3[22m[39m
    [90m920|[39m   });
    [90m921|[39m
    [90m922|[39m   it("POST /api/visao com modelo always-thinking retorna 502 com orienÔÇª
    [90m   |[39m   [31m^[39m
    [90m923|[39m     const ndjson =
    [90m924|[39m       [

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[24/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/server.test.ts[2m > [22mcreateServer[2m > [22mPOST /api/visao com evento de erro do 
Ollama retorna 502 e nao grava log
[31m[1mError[22m: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with 
"testTimeout".[39m
[36m [2mÔØ»[22m src/server.test.ts:[2m958:3[22m[39m
    [90m956|[39m   });
    [90m957|[39m
    [90m958|[39m   it("POST /api/visao com evento de erro do Ollama retorna 502 e nao gÔÇª
    [90m   |[39m   [31m^[39m
    [90m959|[39m     const ndjson = JSON.stringify({ error: "model not loaded" }) + "\nÔÇª
    [90m960|[39m     vi.stubGlobal(

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[25/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/server.test.ts[2m > [22mcreateServer[2m > [22mGET /api/health informa o status do 
Ollama
[31m[1mAssertionError[22m: expected false to be true // Object.is equality[39m

[32m- Expected[39m
[31m+ Received[39m

[32m- true[39m
[31m+ false[39m

[36m [2mÔØ»[22m src/server.test.ts:[2m1295:35[22m[39m
    [90m1293|[39m         ollama: { online: boolean; modelos: string[]; modelo: string };
    [90m1294|[39m       };
    [90m1295|[39m       expect(corpo.ollama.online).toBe(true);
    [90m   |[39m                                   [31m^[39m
    [90m1296|[39m       expect(corpo.ollama.modelos).toContain("qwen3-vl:4b");
    [90m1297|[39m       expect(corpo.ollama.modelo).toBeTruthy();

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[26/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/server.test.ts[2m > [22mcreateServer[2m > [22mGET /api/health troca pelo melhor 
modelo quando o padrao nao esta instalado
[31m[1mAssertionError[22m: expected 'qwen2.5-vl-3b-instruct' to be 'qwen2.5vl:7b' // Object.is equality[39m

Expected: [32m"qwen2.5vl[7m:7b[27m"[39m
Received: [31m"qwen2.5[7m-[27mvl[7m-3b-instruct[27m"[39m

[36m [2mÔØ»[22m src/server.test.ts:[2m1327:35[22m[39m
    [90m1325|[39m       };
    [90m1326|[39m       expect(corpo.ollama.solicitado).toBe(MODELO_PADRAO);
    [90m1327|[39m       expect(corpo.ollama.modelo).toBe("qwen2.5vl:7b");
    [90m   |[39m                                   [31m^[39m
    [90m1328|[39m     } finally {
    [90m1329|[39m       server.close();

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[27/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/server.test.ts[2m > [22mcreateServer[2m > [22mGET /api/health reporta Ollama offline 
quando falha
[31m[1mAssertionError[22m: expected true to be false // Object.is equality[39m

[32m- Expected[39m
[31m+ Received[39m

[32m- false[39m
[31m+ true[39m

[36m [2mÔØ»[22m src/server.test.ts:[2m1350:35[22m[39m
    [90m1348|[39m       const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    [90m1349|[39m       const corpo = (await res.json()) as { ollama: { online: boolean ÔÇª
    [90m1350|[39m       expect(corpo.ollama.online).toBe(false);
    [90m   |[39m                                   [31m^[39m
    [90m1351|[39m     } finally {
    [90m1352|[39m       server.close();

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[28/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/server.test.ts[2m > [22mcreateServer[2m > [22mGET /api/health lista os modelos que 
estao em memoria
[31m[1mAssertionError[22m: expected false to be true // Object.is equality[39m

[32m- Expected[39m
[31m+ Received[39m

[32m- true[39m
[31m+ false[39m

[36m [2mÔØ»[22m src/server.test.ts:[2m1382:35[22m[39m
    [90m1380|[39m         ollama: { online: boolean; carregados: string[] };
    [90m1381|[39m       };
    [90m1382|[39m       expect(corpo.ollama.online).toBe(true);
    [90m   |[39m                                   [31m^[39m
    [90m1383|[39m       expect(corpo.ollama.carregados).toContain("qwen3-vl:4b");
    [90m1384|[39m     } finally {

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[29/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/server.test.ts[2m > [22mcreateServer[2m > [22mPOST /api/visao registra 
visao_cancelada quando o cliente desconecta
[31m[1mError[22m: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with 
"testTimeout".[39m
[36m [2mÔØ»[22m src/server.test.ts:[2m1389:3[22m[39m
    [90m1387|[39m   });
    [90m1388|[39m
    [90m1389|[39m   it("POST /api/visao registra visao_cancelada quando o cliente desconÔÇª
    [90m   |[39m   [31m^[39m
    [90m1390|[39m     let sinalizarInicio: () => void = () => {};
    [90m1391|[39m     const iniciou = new Promise<void>((resolve) => {

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[30/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/server.test.ts[2m > [22mcreateServer[2m > [22mGET /api/visao/preparar confirma o 
modelo em memoria sem disparar geracao
[31m[1mAssertionError[22m: expected 502 to be 200 // Object.is equality[39m

[32m- Expected[39m
[31m+ Received[39m

[32m- 200[39m
[31m+ 502[39m

[36m [2mÔØ»[22m src/server.test.ts:[2m1479:26[22m[39m
    [90m1477|[39m     try {
    [90m1478|[39m       const res = await fetch(`http://127.0.0.1:${port}/api/visao/prepÔÇª
    [90m1479|[39m       expect(res.status).toBe(200);
    [90m   |[39m                          [31m^[39m
    [90m1480|[39m       const corpo = (await res.json()) as { ok: boolean; carregado: boÔÇª
    [90m1481|[39m       expect(corpo.ok).toBe(true);

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[31/32]ÔÄ»[22m[39m

[41m[1m FAIL [22m[49m src/server.test.ts[2m > [22mcreateServer[2m > [22mGET /api/visao/preparar nao confunde 
modelos de mesma base com tags diferentes
[31m[1mAssertionError[22m: expected 0 to be greater than 0[39m
[36m [2mÔØ»[22m src/server.test.ts:[2m1569:28[22m[39m
    [90m1567|[39m       // Nao declara pronto: tenta carregar o modelo solicitado e a caÔÇª
    [90m1568|[39m       expect(res.status).toBe(502);
    [90m1569|[39m       expect(chats.length).toBeGreaterThan(0);
    [90m   |[39m                            [31m^[39m
    [90m1570|[39m       const corpo = (await res.json()) as { ok: boolean };
    [90m1571|[39m       expect(corpo.ok).toBe(false);

[31m[2mÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»ÔÄ»[32/32]ÔÄ»[22m[39m


[2m Test Files [22m [1m[31m2 failed[39m[22m[2m | [22m[1m[32m16 passed[39m[22m[90m (18)[39m
[2m      Tests [22m [1m[31m32 failed[39m[22m[2m | [22m[1m[32m290 passed[39m[22m[90m (322)[39m
[2m   Start at [22m 23:12:19
[2m   Duration [22m 29.54s[2m (tests 81%, transform 15%, import 4%, worker 1%)[22m

---TEST_END---
node.exe : 
No linha:1 caractere:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
  dist\server.js  65.0kb

Done in 28ms
node.exe : 
No linha:1 caractere:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
  public\app.js  54.5kb

Done in 28ms
---BUILD_END---


## Sumario
Typecheck: com erros (4 erros conforme acima)
Lint: OK (sem erros)
Testes: Falham (32 falhas de 322 testes conforme execucao anterior)
Build: OK (server e client compilam)


## Configuracao de benchmark (referencia)
Modelo: conforme bench/BASELINE.md
Backend: WebGPU/WASM e LM Studio (conforme ambiente)
Resolucao: conforme uso
Intervalo configurado: conforme controle da UI (slider)
Hardware: conforme bench/BASELINE.md (Intel Xeon E5-2660 v3, 20 cores, RAM ~15.8GB, AMD Radeon RX 5600 OEM, Windows 10, Node v24.19.0)

Valores de referencia (bench/BASELINE.md): Precisao 25%, Recall 100%, ~6 falsos positivos/min, latencia ~3.4s

