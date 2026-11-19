import type { RegistroCiclo } from "../../src/domain/cycle";
import { ErroPercepcao } from "../../src/erros";
import { exigirRespostaOk } from "./http";

export async function gravarCiclo(registro: RegistroCiclo): Promise<void> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/ciclos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registro),
    });
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao gravar o diagnostico do ciclo", {
      cause: err,
    });
  }
  await exigirRespostaOk(resposta, "Falha ao gravar o diagnostico do ciclo");
}

export async function listarCiclos(limite = 50): Promise<RegistroCiclo[]> {
  let resposta: Response;
  try {
    resposta = await fetch(`/api/ciclos?limit=${limite}`);
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao ler os diagnosticos de ciclo", { cause: err });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as { ciclos?: RegistroCiclo[] };
  return dados.ciclos ?? [];
}

export async function gravarOperacional(registro: {
  nivel?: "info" | "aviso" | "erro";
  origem?: string;
  mensagem: string;
  detalhe?: string;
}): Promise<boolean> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/operacional", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registro),
    });
  } catch {
    // Registro operacional e best-effort: nao interrompe a captura.
    return false;
  }
  return exigirRespostaOk(resposta, "Falha ao registrar operacional")
    .then(() => true)
    .catch(() => false);
}