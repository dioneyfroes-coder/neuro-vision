function periodo<T>(arr: T[]): number {
  const n = arr.length;
  if (n <= 1) return n;
  const pi = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    let j = pi[i - 1];
    while (j > 0 && arr[i] !== arr[j]) j = pi[j - 1];
    if (arr[i] === arr[j]) j++;
    pi[i] = j;
  }
  const p = n - pi[n - 1];
  return n % p === 0 ? p : n;
}

export function separarFrases(texto: string): string[] {
  return (texto ?? "")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
}

export function colapsarRepeticoes(texto: string): string {
  const frases = separarFrases(texto);
  if (!frases.length) return (texto ?? "").trim();

  const saida: string[] = [];
  for (const f of frases) {
    if (saida.length && saida[saida.length - 1] === f) continue;
    saida.push(f);
  }

  for (let volta = 0; volta < 4; volta++) {
    let mudou = false;
    for (let inicio = 0; inicio < saida.length; inicio++) {
      const sub = saida.slice(inicio);
      const p = periodo(sub);
      if (p < sub.length) {
        saida.splice(inicio + p);
        mudou = true;
        break;
      }
    }
    if (!mudou) break;
  }

  return saida.join(" ");
}

export function normalizarTexto(texto: string): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function ehSemMudanca(texto: string): boolean {
  const n = normalizarTexto(texto).replace(/[.!?,;:]+/g, "").trim();
  if (!n) return true;
  if (n.length > 40) return false;
  return /inalterad|sem muda|nada mudou|sem altera|nenhuma muda/.test(n);
}

export function cortarFraseIncompleta(texto: string): string {
  const t = (texto ?? "").trim();
  if (!t) return t;
  if (/[.!?]$/.test(t)) return t;
  const corte = t.match(/^[\s\S]*[.!?]/);
  return corte ? corte[0].trim() : t;
}
