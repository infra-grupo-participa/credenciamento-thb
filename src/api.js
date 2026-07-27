// Camada de acesso à API REST. Lida com o token de login (Bearer)
// e dispara um evento global quando recebe 401 (sessão expirada).

const TOKEN_KEY = 'chf_token';
const OPERADOR_KEY = 'chf_operador';

export const auth = {
  get token() { return localStorage.getItem(TOKEN_KEY) || ''; },
  get operador() { return localStorage.getItem(OPERADOR_KEY) || ''; },
  set({ token, operador }) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(OPERADOR_KEY, operador);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(OPERADOR_KEY);
  },
};

class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// Wi-Fi de evento trava mais do que cai: um timeout vira erro de rede (código
// 'network') para o credenciamento cair na fila offline em vez de ficar pendurado.
const TIMEOUT_MS = 12000;

async function request(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;

  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined,
    });
  } catch {
    throw new ApiError('network', 0); // falha de rede (offline ou timeout)
  }

  if (res.status === 401) {
    auth.clear();
    window.dispatchEvent(new Event('chf:unauthorized'));
    throw new ApiError('unauthorized', 401);
  }

  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { /* ignora */ } }

  if (!res.ok) throw new ApiError((data && data.error) || 'erro', res.status);
  return data;
}

export const api = {
  login: (operador, senha) => request('/login', { method: 'POST', body: { operador, senha } }),
  me: () => request('/me'),

  eventos: () => request('/eventos'),
  criarEvento: (ev) => request('/eventos', { method: 'POST', body: ev }),
  atualizarEvento: (id, ev) => request(`/eventos/${encodeURIComponent(id)}`, { method: 'PUT', body: ev }),
  operadoresPublicos: () => request('/operadores'),
  trocarSenha: (senha) => request('/senha', { method: 'POST', body: { senha } }),
  // since/n: delta-polling — quando nada mudou o servidor devolve { unchanged: true }.
  listar: (eventoId, since, n) => request(
    `/participantes?evento=${encodeURIComponent(eventoId)}`
    + (since && Number.isFinite(n) ? `&since=${encodeURIComponent(since)}&n=${n}` : '')
  ),
  detalhe: (id) => request(`/participantes/${encodeURIComponent(id)}`),
  resolver: async (eventoId, token) => {
    const headers = {};
    if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
    let res;
    try {
      res = await fetch(`/api/resolver?evento=${encodeURIComponent(eventoId)}&token=${encodeURIComponent(token)}`,
        { headers, signal: AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined });
    } catch { return { status: 0 }; }
    if (res.status === 401) { auth.clear(); window.dispatchEvent(new Event('chf:unauthorized')); return { status: 401 }; }
    let body = {}; const t = await res.text(); if (t) { try { body = JSON.parse(t); } catch { /* ignora */ } }
    return { status: res.status, ...body };
  },
  historico: (id) => request(`/participantes/${encodeURIComponent(id)}/historico`),
  auditoria: (eventoId) => request(`/auditoria?evento=${encodeURIComponent(eventoId || '')}`),
  getConfig: (k) => request(`/config/${encodeURIComponent(k)}`),
  setConfig: (k, v) => request(`/config/${encodeURIComponent(k)}`, { method: 'PUT', body: { v } }),
  criar: (p) => request('/participantes', { method: 'POST', body: p }),
  atualizar: (id, p) => request(`/participantes/${encodeURIComponent(id)}`, { method: 'PUT', body: p }),
  credenciar: (id, credenciado) =>
    request(`/participantes/${encodeURIComponent(id)}/credenciar`, { method: 'PATCH', body: { credenciado } }),
  excluir: (id) => request(`/participantes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getFoto: (id) => request(`/participantes/${encodeURIComponent(id)}/foto`),
  setFoto: (id, foto) => request(`/participantes/${encodeURIComponent(id)}/foto`, { method: 'PUT', body: { foto } }),

  exportar: (eventoId) => request(`/export?evento=${encodeURIComponent(eventoId || '')}`),
  importar: (eventoId, list, modo = 'substituir') => request('/import', { method: 'POST', body: { evento: eventoId, list, modo } }),
  previaImportar: (eventoId, list) => request('/import/previa', { method: 'POST', body: { evento: eventoId, list } }),
};
