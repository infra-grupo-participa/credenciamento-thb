// Fila de credenciamentos feitos offline, persistida no localStorage.
// Reenviada quando a conexão volta. credenciar é idempotente (seta true/false),
// então reprocessar é seguro.
const KEY = 'chf_fila_credenciamento';

function ler() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function gravar(f) { localStorage.setItem(KEY, JSON.stringify(f)); }

export function tamanhoFila() { return ler().length; }

export function enfileirar(op) {
  const f = ler().filter((x) => x.id !== op.id); // mantém só a última decisão por pessoa
  f.push({ ...op, t: Date.now() });
  gravar(f);
}

// req = async (id, credenciado) => ... ; retorna quantos sincronizou.
export async function flushFila(req) {
  const f = ler();
  if (!f.length) return 0;
  const restantes = [];
  let ok = 0;
  for (const op of f) {
    try { await req(op.id, op.credenciado); ok++; }
    catch { restantes.push(op); }
  }
  gravar(restantes);
  return ok;
}
