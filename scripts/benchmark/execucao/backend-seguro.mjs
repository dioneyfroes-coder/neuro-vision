/** URL do backend sem credenciais, para relatorios versionaveis. */
export function backendSeguro(valor) {
  if (!valor) return "http://localhost:1234 (padrao do servidor)";
  try {
    const url = new URL(valor);
    url.username = "";
    url.password = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return String(valor);
  }
}
