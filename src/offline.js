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
  const enviados = new Set();
  let ok = 0;
  for (const op of f) {
    try { await req(op.id, op.credenciado); ok++; enviados.add(`${op.id}|${op.t}`); }
    catch { /* fica na fila para a próxima tentativa */ }
  }
  // Re-lê a fila ANTES de gravar, em vez de regravar o snapshot do início.
  // Cada envio pode demorar até o timeout de 12 s; num servidor engasgado o flush
  // leva 12 s x tamanho da fila, e é justamente aí que o operador mais enfileira.
  // Gravar o snapshot antigo apagava tudo que entrou nesse meio-tempo — some um
  // credenciamento que a tela já confirmou como salvo, sem nenhum aviso.
  // A chave id|t preserva quem foi re-enfileirado durante o flush (t novo).
  gravar(ler().filter((x) => !enviados.has(`${x.id}|${x.t}`)));
  return ok;
}
