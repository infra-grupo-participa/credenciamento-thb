'use strict';

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const db = require('./db');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' })); // 8mb cobre fotos em base64

const PORT = process.env.PORT || 3000;
// Senha do evento: pode ser sobrescrita pela variável de ambiente ACCESS_PASSWORD.
// Default embutido para o app funcionar sem configuração extra (como na versão original).
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || 'Clinica@102030@THB';
// Segredo de assinatura dos tokens. RECOMENDADO definir SESSION_SECRET no painel
// (qualquer string longa e aleatória); sem ela usa este placeholder.
const SECRET = process.env.SESSION_SECRET || 'chf2026-troque-no-painel-com-SESSION_SECRET';

/* ============================ AUTENTICAÇÃO ============================ */
// Token assinado (HMAC) e stateless — sobrevive a redeploys, sem sessão em memória.

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function auth(req, res, next) {
  const header = req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const data = verifyToken(token);
  if (!data) return res.status(401).json({ error: 'unauthorized' });
  req.operador = data.operador || 'operador';
  next();
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// Senha do evento: usa a salva no painel (app_config 'auth'), senão a do ambiente.
async function senhaValida(senha) {
  try {
    const cfg = await db.repo.getConfig('auth');
    if (cfg && cfg.senhaHash) return sha256(senha) === cfg.senhaHash;
  } catch { /* cai para a do ambiente */ }
  return !!ACCESS_PASSWORD && senha === ACCESS_PASSWORD;
}

/* ============================== ROTAS API ============================== */
const api = express.Router();

// Login: nome do operador + senha do evento -> token.
api.post('/login', async (req, res) => {
  const operador = String(req.body.operador || '').trim().slice(0, 120);
  const senha = String(req.body.senha || '');
  if (!operador) return res.status(400).json({ error: 'informe_o_nome' });
  if (!(await senhaValida(senha))) return res.status(401).json({ error: 'senha_invalida' });
  const token = signToken({ operador, iat: Date.now() });
  res.json({ token, operador });
});

// Lista pública de operadores (apenas nomes) — usada como sugestão no login.
api.get('/operadores', async (req, res) => {
  try {
    const v = await db.repo.getConfig('operadores');
    res.json({ operadores: Array.isArray(v) ? v : [] });
  } catch {
    res.json({ operadores: [] });
  }
});

// Trocar a senha do evento (salva no painel).
api.post('/senha', auth, async (req, res) => {
  const nova = String(req.body.senha || '');
  if (nova.length < 4) return res.status(400).json({ error: 'senha_curta' });
  try {
    await db.repo.setConfig('auth', { senhaHash: sha256(nova) });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'senha_failed' });
  }
});

// CRUD de eventos (criar / atualizar) — gestão pelo painel.
api.post('/eventos', auth, async (req, res) => {
  try {
    const ev = await db.repo.criarEvento(req.body);
    if (!ev) return res.status(400).json({ error: 'nome_obrigatorio' });
    res.status(201).json(ev);
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: 'evento_create_failed' });
  }
});
api.put('/eventos/:id', auth, async (req, res) => {
  try {
    const ev = await db.repo.atualizarEvento(req.params.id, req.body);
    if (!ev) return res.status(404).json({ error: 'nao_encontrado' });
    res.json(ev);
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: 'evento_update_failed' });
  }
});

// Verifica se o token ainda é válido (usado ao abrir o app).
api.get('/me', auth, (req, res) => res.json({ operador: req.operador }));

// Eventos (com contadores) — inclui arquivados (histórico).
api.get('/eventos', auth, async (req, res) => {
  try {
    res.json({ eventos: await db.repo.listarEventos() });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: 'eventos_failed' });
  }
});

// Lista (leve) de um evento — base do polling.
api.get('/participantes', auth, async (req, res) => {
  try {
    const evento = String(req.query.evento || '');
    if (!evento) return res.status(400).json({ error: 'evento_obrigatorio' });
    res.json(await db.repo.listar(evento));
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: 'read_failed' });
  }
});

// Detalhe completo de um participante (para o modal).
api.get('/participantes/:id', auth, async (req, res) => {
  try {
    const p = await db.repo.detalhe(req.params.id);
    if (!p) return res.status(404).json({ error: 'nao_encontrado' });
    res.json(p);
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: 'detalhe_failed' });
  }
});

// Resolve uma pessoa pelo token DENTRO do evento/dia ativo (para o scanner).
api.get('/resolver', auth, async (req, res) => {
  const evento = String(req.query.evento || '');
  const token = String(req.query.token || '');
  try {
    const p = await db.repo.porToken(evento, token);
    if (p) return res.json(p);
    // Não está neste evento: identifica em quais eventos a pessoa está.
    const achados = await db.repo.localizar(token);
    if (achados.length) {
      return res.status(409).json({ error: 'evento_errado', nome: achados[0].nome, eventos: [...new Set(achados.map((a) => a.evento_id))] });
    }
    res.status(404).json({ error: 'nao_encontrado' });
  } catch (e) {
    res.status(500).json({ error: 'resolver_failed' });
  }
});

// Histórico da pessoa em todos os eventos (por documento/e-mail).
api.get('/participantes/:id/historico', auth, async (req, res) => {
  try {
    res.json({ historico: await db.repo.historicoPessoa(req.params.id) });
  } catch (e) {
    res.status(500).json({ error: 'historico_failed' });
  }
});

// Cria participante.
api.post('/participantes', auth, async (req, res) => {
  try {
    const criado = await db.repo.criar(req.body);
    if (!criado) return res.status(400).json({ error: 'nome_obrigatorio' });
    await db.audit(criado.id, criado.nome, 'criar', req.operador, null, criado.evento_id);
    res.status(201).json(criado);
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: 'create_failed' });
  }
});

// Atualiza dados cadastrais (não mexe no status de credenciamento).
api.put('/participantes/:id', auth, async (req, res) => {
  try {
    const atualizado = await db.repo.atualizar(req.params.id, req.body);
    if (!atualizado) return res.status(404).json({ error: 'nao_encontrado' });
    await db.audit(atualizado.id, atualizado.nome, 'editar', req.operador, null);
    res.json(atualizado);
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: 'update_failed' });
  }
});

// Credenciar / descredenciar — operação atômica, sem sobrescrever o resto.
api.patch('/participantes/:id/credenciar', auth, async (req, res) => {
  try {
    const credenciado = !!req.body.credenciado;
    const atualizado = await db.repo.credenciar(req.params.id, credenciado);
    if (!atualizado) return res.status(404).json({ error: 'nao_encontrado' });
    await db.audit(req.params.id, atualizado.nome, credenciado ? 'credenciar' : 'descredenciar', req.operador, null, atualizado.evento_id);
    res.json(atualizado);
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: 'patch_failed' });
  }
});

// Exclui participante.
api.delete('/participantes/:id', auth, async (req, res) => {
  try {
    const ok = await db.repo.excluir(req.params.id);
    if (!ok) return res.status(404).json({ error: 'nao_encontrado' });
    await db.audit(req.params.id, null, 'excluir', req.operador, null);
    res.json({ ok: true });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: 'delete_failed' });
  }
});

// Foto — carregada/salva sob demanda (fica fora da listagem por ser pesada).
api.get('/participantes/:id/foto', auth, async (req, res) => {
  try {
    const foto = await db.repo.getFoto(req.params.id);
    if (foto === null) return res.status(404).json({ error: 'nao_encontrado' });
    res.json({ foto });
  } catch (e) {
    res.status(500).json({ error: 'foto_read_failed' });
  }
});

api.put('/participantes/:id/foto', auth, async (req, res) => {
  try {
    const foto = req.body.foto == null ? '' : String(req.body.foto);
    const ok = await db.repo.setFoto(req.params.id, foto);
    if (!ok) return res.status(404).json({ error: 'nao_encontrado' });
    await db.audit(req.params.id, null, foto ? 'foto_definir' : 'foto_remover', req.operador, null);
    res.json({ ok: true, temFoto: !!foto });
  } catch (e) {
    res.status(500).json({ error: 'foto_save_failed' });
  }
});

// Exportar backup de um evento (com fotos).
api.get('/export', auth, async (req, res) => {
  try {
    const list = await db.repo.exportar(String(req.query.evento || ''));
    res.json({ list, exportedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: 'export_failed' });
  }
});

// Importar lista de UM evento (substitui só aquele evento).
api.post('/import', auth, async (req, res) => {
  const list = Array.isArray(req.body.list) ? req.body.list : null;
  const evento = String(req.body.evento || '');
  const modo = req.body.modo === 'adicionar' ? 'adicionar' : 'substituir';
  if (!list || !evento) return res.status(400).json({ error: 'invalid_payload' });
  try {
    const count = await db.repo.importarLista(evento, list, modo);
    await db.audit(null, null, 'importar', req.operador, `${count} registros (${modo})`, evento);
    res.json({ ok: true, count });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: 'import_failed' });
  }
});

// Healthcheck simples.
app.get('/health', (req, res) => res.json({ ok: true }));

// Auditoria (quem credenciou quem, quando) — opcionalmente por evento.
api.get('/auditoria', auth, async (req, res) => {
  try {
    res.json({ itens: await db.repo.auditoria(String(req.query.evento || ''), Number(req.query.limit) || 300) });
  } catch (e) {
    res.status(500).json({ error: 'auditoria_failed' });
  }
});

// Config global (ex.: campos fixados no modal de detalhes).
api.get('/config/:k', auth, async (req, res) => {
  try {
    res.json({ v: await db.repo.getConfig(req.params.k) });
  } catch (e) {
    res.status(500).json({ error: 'config_read_failed' });
  }
});
api.put('/config/:k', auth, async (req, res) => {
  try {
    await db.repo.setConfig(req.params.k, req.body.v ?? null);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'config_save_failed' });
  }
});

app.use('/api', api);

/* ==================== FRONT-END (build do Vite em /dist) ==================== */
const DIST = path.join(__dirname, 'dist');

// Página pública do QR do participante (token) — para enviar ao aluno.
app.get('/qr/:token', async (req, res) => {
  const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  try {
    let nome = '';
    try { nome = await db.repo.nomePorToken(req.params.token); } catch { /* segue */ }
    const dataUrl = await QRCode.toDataURL(String(req.params.token), { margin: 1, width: 320 });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Seu QR — Credenciamento THB</title>
      <style>body{margin:0;font-family:Inter,system-ui,Arial,sans-serif;background:#f4f5f7;color:#1d1d1b;
      display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
      .card{background:#fff;border:1px solid #e5e7ec;border-radius:18px;box-shadow:0 12px 30px rgba(29,29,27,.1);padding:28px;text-align:center;max-width:360px;width:100%}
      .sub{color:#ef7c00;font-weight:700;font-size:13px}h1{font-size:22px;margin:8px 0 2px}
      p{color:#6f7682;font-size:14px;margin:6px 0 18px}img{width:280px;height:280px}</style></head>
      <body><div class="card"><div class="sub">TIME HOLDING BRASIL</div>
      <h1>${esc(nome) || 'Seu credenciamento'}</h1>
      <p>Mostre este QR na entrada para credenciar mais rápido.</p>
      <img src="${dataUrl}" alt="QR de credenciamento"/></div></body></html>`);
  } catch {
    res.status(404).send('QR não encontrado');
  }
});

app.use(express.static(DIST));

// Fallback SPA: qualquer rota que não seja /api devolve o index.html.
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(DIST, 'index.html'), (err) => {
    if (err) {
      res.status(503).send(
        '<h1>Build do front-end não encontrado</h1>' +
        '<p>Rode <code>npm run build</code> (ou configure o build na Hostinger) para gerar a pasta <code>dist</code>.</p>'
      );
    }
  });
});

/* =============================== STARTUP =============================== */
(async () => {
  try {
    await db.init();
    console.log('[db] Supabase conectado');
  } catch (e) {
    console.error('[db] falha ao iniciar o banco:', e.message);
    // Sobe mesmo assim para servir o front e mostrar erro amigável.
  }
  app.listen(PORT, () => console.log(`Credenciamento rodando em http://localhost:${PORT}`));
})();
