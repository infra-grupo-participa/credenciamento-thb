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
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || 'dev-secret-troque-isto';

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

async function audit(participante, nome, acao, operador, detalhe) {
  try {
    await db.getPool().query(
      'INSERT INTO auditoria (participante, nome, acao, operador, detalhe) VALUES (?,?,?,?,?)',
      [participante || null, nome || null, acao, operador || null, detalhe || null]
    );
  } catch (e) {
    console.error('[audit]', e.message);
  }
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

const SELECT_LIGHT = `
  SELECT id, nome, nomeCracha, email, telefone, turma, profissao, tamanhoCamisa,
         dataChegada, dataRetorno, instrucao, recebeuCracha, credenciado,
         dataCredenciamento, observacoes,
         (foto IS NOT NULL AND foto <> '') AS temFoto, updated_at
  FROM participantes`;

function shape(r) {
  return {
    ...r,
    recebeuCracha: !!r.recebeuCracha,
    credenciado: !!r.credenciado,
    temFoto: !!r.temFoto,
  };
}

// Lista completa (sem fotos) + carimbo da última alteração — base do polling.
api.get('/participantes', auth, async (req, res) => {
  try {
    const [rows] = await db.getPool().query(`${SELECT_LIGHT} ORDER BY nome ASC`);
    const [[{ updatedAt }]] = await db.getPool().query(
      'SELECT MAX(updated_at) AS updatedAt FROM participantes'
    );
    res.json({ list: rows.map(shape), updatedAt: updatedAt || null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'read_failed' });
  }
});

// Cria participante.
api.post('/participantes', auth, async (req, res) => {
  const row = db.normalize(req.body, { generateId: true });
  if (!row) return res.status(400).json({ error: 'nome_obrigatorio' });
  try {
    await db.getPool().query('INSERT INTO participantes SET ?', [row]);
    await audit(row.id, row.nome, 'criar', req.operador, null);
    const [[created]] = await db.getPool().query(`${SELECT_LIGHT} WHERE id = ?`, [row.id]);
    res.status(201).json(shape(created));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'create_failed' });
  }
});

// Atualiza dados cadastrais (não mexe no status de credenciamento).
api.put('/participantes/:id', auth, async (req, res) => {
  const row = db.normalize({ ...req.body, id: req.params.id });
  if (!row) return res.status(400).json({ error: 'nome_obrigatorio' });
  try {
    const [r] = await db.getPool().query(
      `UPDATE participantes SET nome=?, nomeCracha=?, email=?, telefone=?, turma=?,
         profissao=?, tamanhoCamisa=?, dataChegada=?, dataRetorno=?, instrucao=?,
         observacoes=? WHERE id=?`,
      [row.nome, row.nomeCracha, row.email, row.telefone, row.turma, row.profissao,
       row.tamanhoCamisa, row.dataChegada, row.dataRetorno, row.instrucao,
       row.observacoes, row.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'nao_encontrado' });
    await audit(row.id, row.nome, 'editar', req.operador, null);
    const [[updated]] = await db.getPool().query(`${SELECT_LIGHT} WHERE id = ?`, [row.id]);
    res.json(shape(updated));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'update_failed' });
  }
});

// Credenciar / descredenciar — operação atômica, sem sobrescrever o resto.
api.patch('/participantes/:id/credenciar', auth, async (req, res) => {
  const credenciado = !!req.body.credenciado ? 1 : 0;
  const quando = credenciado ? new Date().toISOString() : '';
  try {
    const [r] = await db.getPool().query(
      'UPDATE participantes SET credenciado=?, recebeuCracha=?, dataCredenciamento=? WHERE id=?',
      [credenciado, credenciado, quando, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'nao_encontrado' });
    const [[updated]] = await db.getPool().query(`${SELECT_LIGHT} WHERE id = ?`, [req.params.id]);
    await audit(req.params.id, updated.nome, credenciado ? 'credenciar' : 'descredenciar', req.operador, null);
    res.json(shape(updated));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'patch_failed' });
  }
});

// Exclui participante.
api.delete('/participantes/:id', auth, async (req, res) => {
  try {
    const [[p]] = await db.getPool().query('SELECT nome FROM participantes WHERE id=?', [req.params.id]);
    const [r] = await db.getPool().query('DELETE FROM participantes WHERE id=?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'nao_encontrado' });
    await audit(req.params.id, p ? p.nome : null, 'excluir', req.operador, null);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'delete_failed' });
  }
});

// Foto — carregada/salva sob demanda (fica fora da listagem por ser pesada).
api.get('/participantes/:id/foto', auth, async (req, res) => {
  try {
    const [[row]] = await db.getPool().query('SELECT foto FROM participantes WHERE id=?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'nao_encontrado' });
    res.json({ foto: row.foto || '' });
  } catch (e) {
    res.status(500).json({ error: 'foto_read_failed' });
  }
});

api.put('/participantes/:id/foto', auth, async (req, res) => {
  const foto = req.body.foto == null ? '' : String(req.body.foto);
  try {
    const [r] = await db.getPool().query('UPDATE participantes SET foto=? WHERE id=?', [foto, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'nao_encontrado' });
    await audit(req.params.id, null, foto ? 'foto_definir' : 'foto_remover', req.operador, null);
    res.json({ ok: true, temFoto: !!foto });
  } catch (e) {
    res.status(500).json({ error: 'foto_save_failed' });
  }
});

// Exportar backup completo (com fotos).
api.get('/export', auth, async (req, res) => {
  try {
    const [rows] = await db.getPool().query(
      `SELECT id, nome, nomeCracha, email, telefone, turma, profissao, tamanhoCamisa,
              dataChegada, dataRetorno, instrucao, recebeuCracha, credenciado,
              dataCredenciamento, observacoes, foto
       FROM participantes ORDER BY nome ASC`
    );
    const list = rows.map((r) => ({ ...r, recebeuCracha: !!r.recebeuCracha, credenciado: !!r.credenciado }));
    res.json({ list, exportedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: 'export_failed' });
  }
});

// Importar lista (substitui tudo) — usado pelo botão "Importar".
api.post('/import', auth, async (req, res) => {
  const list = Array.isArray(req.body.list) ? req.body.list : null;
  if (!list) return res.status(400).json({ error: 'invalid_payload' });
  const conn = await db.getPool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM participantes');
    for (const p of list) {
      const row = db.normalize(p, { generateId: true });
      if (row) await conn.query('INSERT INTO participantes SET ?', [row]);
    }
    await conn.commit();
    await audit(null, null, 'importar', req.operador, `${list.length} registros`);
    res.json({ ok: true, count: list.length });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: 'import_failed' });
  } finally {
    conn.release();
  }
});

// Restaurar lista oficial (re-seed do data.json).
api.post('/reset', auth, async (req, res) => {
  try {
    await db.getPool().query('DELETE FROM participantes');
    await db.seedFromFile();
    await audit(null, null, 'resetar', req.operador, 'restaurada lista oficial');
    res.json({ ok: true });
  } catch (e) {
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
    console.log('[db] tabelas prontas');
  } catch (e) {
    console.error('[db] falha ao iniciar o banco:', e.message);
    // Sobe mesmo assim para servir uma mensagem de erro amigável no front.
  }
  app.listen(PORT, () => console.log(`Credenciamento rodando em http://localhost:${PORT}`));
})();
