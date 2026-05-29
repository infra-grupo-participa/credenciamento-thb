'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

let pool = null;

/** Pool de conexões MySQL (reaproveitado em toda a aplicação). */
function getPool() {
  if (pool) return pool;
  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4',
    // Datas e horários como string ISO para previsibilidade.
    dateStrings: true,
  });
  return pool;
}

/** Campos do participante (sem a foto, que é pesada e fica fora da listagem). */
const LIST_COLS = [
  'id', 'nome', 'nomeCracha', 'email', 'telefone', 'turma', 'profissao',
  'tamanhoCamisa', 'dataChegada', 'dataRetorno', 'instrucao',
  'recebeuCracha', 'credenciado', 'dataCredenciamento', 'observacoes',
  'temFoto', 'updated_at',
];

/** Cria as tabelas (idempotente) e importa o seed na primeira execução. */
async function init() {
  const db = getPool();

  await db.query(`
    CREATE TABLE IF NOT EXISTS participantes (
      id                 VARCHAR(64)  NOT NULL PRIMARY KEY,
      nome               VARCHAR(255) NOT NULL,
      nomeCracha         VARCHAR(255) NULL,
      email              VARCHAR(255) NULL,
      telefone           VARCHAR(64)  NULL,
      turma              VARCHAR(32)  NULL,
      profissao          VARCHAR(255) NULL,
      tamanhoCamisa      VARCHAR(16)  NULL,
      dataChegada        VARCHAR(32)  NULL,
      dataRetorno        VARCHAR(32)  NULL,
      instrucao          VARCHAR(128) NULL,
      recebeuCracha      TINYINT(1)   NOT NULL DEFAULT 0,
      credenciado        TINYINT(1)   NOT NULL DEFAULT 0,
      dataCredenciamento VARCHAR(64)  NULL,
      observacoes        TEXT         NULL,
      foto               LONGTEXT     NULL,
      criado_em          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_nome (nome),
      INDEX idx_credenciado (credenciado),
      INDEX idx_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS auditoria (
      id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
      participante  VARCHAR(64)  NULL,
      nome          VARCHAR(255) NULL,
      acao          VARCHAR(32)  NOT NULL,
      operador      VARCHAR(120) NULL,
      detalhe       TEXT         NULL,
      criado_em     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_criado (criado_em),
      INDEX idx_participante (participante)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Seed inicial só se a tabela estiver vazia.
  const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM participantes');
  if (total === 0) await seedFromFile();
}

/** Importa data.json (aceita {list:[...]} ou [...]) quando a tabela está vazia. */
async function seedFromFile() {
  const file = process.env.SEED_FILE || path.join(__dirname, 'data.json');
  const full = path.isAbsolute(file) ? file : path.join(__dirname, file);
  if (!fs.existsSync(full)) return;

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch {
    return;
  }
  const list = Array.isArray(parsed) ? parsed : parsed.list;
  if (!Array.isArray(list) || !list.length) return;

  const db = getPool();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const p of list) {
      const row = normalize(p);
      if (!row) continue;
      await conn.query('INSERT IGNORE INTO participantes SET ?', [row]);
    }
    await conn.query(
      "INSERT INTO auditoria (acao, operador, detalhe) VALUES ('seed', 'sistema', ?)",
      [`Importados ${list.length} registros de data.json`]
    );
    await conn.commit();
    console.log(`[seed] ${list.length} participantes importados de ${path.basename(full)}`);
  } catch (e) {
    await conn.rollback();
    console.error('[seed] falhou:', e.message);
  } finally {
    conn.release();
  }
}

/** Sanitiza/normaliza um registro vindo do cliente ou do seed. */
function normalize(p, { generateId = false } = {}) {
  const s = (v, max) => (v == null ? '' : String(v)).slice(0, max);
  const id = s(p.id, 64).trim() || (generateId ? newId() : '');
  const nome = s(p.nome, 255).trim();
  if (!id || !nome) return null;
  return {
    id,
    nome,
    nomeCracha: s(p.nomeCracha, 255),
    email: s(p.email, 255),
    telefone: s(p.telefone, 64),
    turma: s(p.turma, 32),
    profissao: s(p.profissao, 255),
    tamanhoCamisa: s(p.tamanhoCamisa, 16),
    dataChegada: s(p.dataChegada, 32),
    dataRetorno: s(p.dataRetorno, 32),
    instrucao: s(p.instrucao, 128),
    recebeuCracha: p.recebeuCracha ? 1 : 0,
    credenciado: p.credenciado ? 1 : 0,
    dataCredenciamento: s(p.dataCredenciamento, 64),
    observacoes: p.observacoes == null ? '' : String(p.observacoes),
    foto: p.foto == null ? '' : String(p.foto),
  };
}

function newId() {
  return 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

module.exports = { getPool, init, seedFromFile, normalize, newId, LIST_COLS };
