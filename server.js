'use strict';

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
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

/* ============================== ROTAS API ============================== */
const api = express.Router();

// Login: nome do operador + senha do evento -> token.
api.post('/login', (req, res) => {
  const operador = String(req.body.operador || '').trim().slice(0, 120);
  const senha = String(req.body.senha || '');
  if (!operador) return res.status(400).json({ error: 'informe_o_nome' });
  if (!ACCESS_PASSWORD || senha !== ACCESS_PASSWORD) {
    return res.status(401).json({ error: 'senha_invalida' });
  }
  const token = signToken({ operador, iat: Date.now() });
  res.json({ token, operador });
});

// Verifica se o token ainda é válido (usado ao abrir o app).
api.get('/me', auth, (req, res) => res.json({ operador: req.operador }));

// Lista completa (sem fotos) — base do polling.
api.get('/participantes', auth, async (req, res) => {
  try {
    res.json(await db.repo.listar());
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: 'read_failed' });
  }
});

// Cria participante.
api.post('/participantes', auth, async (req, res) => {
  try {
    const criado = await db.repo.criar(req.body);
    if (!criado) return res.status(400).json({ error: 'nome_obrigatorio' });
    await db.audit(criado.id, criado.nome, 'criar', req.operador, null);
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
    await db.audit(req.params.id, atualizado.nome, credenciado ? 'credenciar' : 'descredenciar', req.operador, null);
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

// Exportar backup completo (com fotos).
api.get('/export', auth, async (req, res) => {
  try {
    const list = await db.repo.exportar();
    res.json({ list, exportedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: 'export_failed' });
  }
});

// Importar lista (substitui tudo) — usado pelo botão "Importar".
api.post('/import', auth, async (req, res) => {
  const list = Array.isArray(req.body.list) ? req.body.list : null;
  if (!list) return res.status(400).json({ error: 'invalid_payload' });
  try {
    const count = await db.repo.substituirTudo(list);
    await db.audit(null, null, 'importar', req.operador, `${count} registros`);
    res.json({ ok: true, count });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: 'import_failed' });
  }
});

// Restaurar lista oficial (re-seed do data.json).
api.post('/reset', auth, async (req, res) => {
  try {
    const n = await db.seedFromFile();
    await db.audit(null, null, 'resetar', req.operador, 'restaurada lista oficial');
    res.json({ ok: true, count: n });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: 'reset_failed' });
  }
});

// Healthcheck simples.
app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api', api);

/* ==================== FRONT-END (build do Vite em /dist) ==================== */
const DIST = path.join(__dirname, 'dist');
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
