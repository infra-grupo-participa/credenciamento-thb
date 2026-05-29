'use strict';

const { createClient } = require('@supabase/supabase-js');

let client = null;

/**
 * Credenciais do Supabase (aceita vários nomes; URL pública embutida como padrão).
 * Prefere a service_role key (ignora RLS).
 */
function supabaseConfig() {
  const e = process.env;
  const url = e.SUPABASE_URL || e.SUPABASE_PROJECT_URL || e.NEXT_PUBLIC_SUPABASE_URL || e.VITE_SUPABASE_URL
    || 'https://soptmfyrsrvceqvdueiw.supabase.co';
  const key = e.SUPABASE_SERVICE_ROLE_KEY || e.SUPABASE_SERVICE_KEY || e.SUPABASE_KEY
    || e.SUPABASE_ANON_KEY || e.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return { url, key };
}

function sb() {
  if (client) return client;
  const { url, key } = supabaseConfig();
  if (!url || !key) {
    throw new Error('config_supabase_ausente: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ou a anon key)');
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

function unwrap({ data, error }) {
  if (error) throw new Error(error.message || 'supabase_error');
  return data;
}

const TABELA = 'participantes';
// Colunas leves da listagem (sem foto nem dados_extra).
const LIGHT = 'id,evento_id,nome,nomeCracha,email,telefone,turma,profissao,instrucao,tipo,grupoDiamante,convidadoPor,recebeuCracha,credenciado,dataCredenciamento,temFoto,updated_at';
// Colunas do detalhe (tudo exceto a foto, que é carregada à parte).
const DETALHE = 'id,evento_id,nome,nomeCracha,email,telefone,documento,cidade,estado,turma,profissao,instrucao,nivel,faturamento,tamanhoCamisa,tipo,grupoDiamante,convidadoPor,convidadoPorId,observacoes,dataChegada,dataRetorno,dataCredenciamento,recebeuCracha,credenciado,dados_extra,temFoto,criado_em,updated_at';

function shape(r) {
  if (!r) return r;
  return { ...r, recebeuCracha: !!r.recebeuCracha, credenciado: !!r.credenciado, temFoto: !!r.temFoto };
}

/* ---------- Normalização (criação/edição manual) ---------- */
function normalize(p, { generateId = false } = {}) {
  const s = (v, max) => (v == null ? '' : String(v)).slice(0, max);
  const id = s(p.id, 64).trim() || (generateId ? newId() : '');
  const nome = s(p.nome, 255).trim();
  if (!id || !nome) return null;
  return {
    id,
    evento_id: s(p.evento_id, 64) || null,
    nome,
    nomeCracha: s(p.nomeCracha, 255),
    email: s(p.email, 255),
    telefone: s(p.telefone, 64),
    documento: p.documento == null ? null : String(p.documento),
    cidade: p.cidade == null ? null : String(p.cidade),
    estado: s(p.estado, 64) || null,
    turma: s(p.turma, 32),
    profissao: s(p.profissao, 255),
    instrucao: s(p.instrucao, 128),
    nivel: p.nivel == null ? null : String(p.nivel),
    faturamento: p.faturamento == null ? null : String(p.faturamento),
    tamanhoCamisa: s(p.tamanhoCamisa, 16),
    tipo: ['comum', 'socio', 'diamante', 'convidado'].includes(p.tipo) ? p.tipo : 'comum',
    grupoDiamante: p.grupoDiamante ? String(p.grupoDiamante) : null,
    convidadoPor: p.convidadoPor ? String(p.convidadoPor) : null,
    observacoes: p.observacoes == null ? '' : String(p.observacoes),
    foto: p.foto == null ? '' : String(p.foto),
  };
}

function newId() {
  return 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

const repo = {
  async listarEventos() {
    return unwrap(await sb().from('vw_eventos').select('*').order('ordem', { ascending: true }));
  },

  async listar(eventoId) {
    let q = sb().from(TABELA).select(LIGHT).order('nome', { ascending: true });
    if (eventoId) q = q.eq('evento_id', eventoId);
    const data = unwrap(await q);
    const updatedAt = data.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), null);
    return { list: data.map(shape), updatedAt };
  },

  async detalhe(id) {
    const data = unwrap(await sb().from(TABELA).select(DETALHE).eq('id', id));
    return data.length ? shape(data[0]) : null;
  },

  async criar(p) {
    const row = normalize(p, { generateId: true });
    if (!row) return null;
    return shape(unwrap(await sb().from(TABELA).insert(row).select(LIGHT).single()));
  },

  async atualizar(id, p) {
    const row = normalize({ ...p, id });
    if (!row) return null;
    const campos = {
      nome: row.nome, nomeCracha: row.nomeCracha, email: row.email, telefone: row.telefone,
      documento: row.documento, cidade: row.cidade, estado: row.estado, turma: row.turma,
      profissao: row.profissao, instrucao: row.instrucao, nivel: row.nivel, faturamento: row.faturamento,
      tamanhoCamisa: row.tamanhoCamisa, tipo: row.tipo, grupoDiamante: row.grupoDiamante,
      convidadoPor: row.convidadoPor, observacoes: row.observacoes, updated_at: new Date().toISOString(),
    };
    const data = unwrap(await sb().from(TABELA).update(campos).eq('id', id).select(LIGHT));
    return data[0] ? shape(data[0]) : null;
  },

  async credenciar(id, credenciado) {
    const quando = credenciado ? new Date().toISOString() : '';
    const data = unwrap(await sb().from(TABELA)
      .update({ credenciado, recebeuCracha: credenciado, dataCredenciamento: quando, updated_at: new Date().toISOString() })
      .eq('id', id).select(LIGHT));
    return data[0] ? shape(data[0]) : null;
  },

  async excluir(id) {
    const data = unwrap(await sb().from(TABELA).delete().eq('id', id).select('id'));
    return data.length > 0;
  },

  async getFoto(id) {
    const data = unwrap(await sb().from(TABELA).select('foto').eq('id', id));
    return data.length ? (data[0].foto || '') : null;
  },

  async setFoto(id, foto) {
    const data = unwrap(await sb().from(TABELA)
      .update({ foto: foto || '', updated_at: new Date().toISOString() }).eq('id', id).select('id'));
    return data.length > 0;
  },

  async exportar(eventoId) {
    let q = sb().from(TABELA).select(`${DETALHE},foto`).order('nome', { ascending: true });
    if (eventoId) q = q.eq('evento_id', eventoId);
    return unwrap(await q).map(shape);
  },

  // Histórico cross-evento da pessoa (mesma por documento/e-mail).
  async detalhePessoaChaves(id) {
    const data = unwrap(await sb().from(TABELA).select('documento,email').eq('id', id));
    return data[0] || null;
  },
  async historicoPessoa(id) {
    const chaves = await this.detalhePessoaChaves(id);
    if (!chaves) return [];
    const doc = (chaves.documento || '').replace(/\D/g, '');
    const email = (chaves.email || '').trim().toLowerCase();
    const ors = [];
    if (doc) ors.push(`documento.eq.${chaves.documento}`);
    if (email) ors.push(`email.ilike.${email}`);
    if (!ors.length) return [];
    const data = unwrap(await sb().from(TABELA)
      .select('id,evento_id,credenciado,dataCredenciamento')
      .or(ors.join(',')));
    return data.map((r) => ({ ...r, credenciado: !!r.credenciado }));
  },

  async auditoria(eventoId, limit = 300) {
    let q = sb().from('auditoria')
      .select('id,participante,nome,acao,operador,detalhe,criado_em')
      .order('criado_em', { ascending: false }).limit(limit);
    if (eventoId) q = q.eq('evento_id', eventoId);
    return unwrap(await q);
  },

  async getConfig(k) {
    const data = unwrap(await sb().from('app_config').select('v').eq('k', k));
    return data.length ? data[0].v : null;
  },
  async setConfig(k, v) {
    unwrap(await sb().from('app_config').upsert({ k, v, updated_at: new Date().toISOString() }, { onConflict: 'k' }));
    return true;
  },

  // Substitui apenas a lista de UM evento (usado pelo Importar).
  async substituirEvento(eventoId, list) {
    if (!eventoId) throw new Error('evento_obrigatorio');
    unwrap(await sb().from(TABELA).delete().eq('evento_id', eventoId));
    const rows = list.map((p) => normalize({ ...p, evento_id: eventoId }, { generateId: true })).filter(Boolean);
    for (let i = 0; i < rows.length; i += 500) {
      unwrap(await sb().from(TABELA).insert(rows.slice(i, i + 500)));
    }
    return rows.length;
  },
};

async function audit(participante, nome, acao, operador, detalhe, evento_id) {
  try {
    await sb().from('auditoria').insert({
      participante: participante || null, nome: nome || null, acao,
      operador: operador || null, detalhe: detalhe || null, evento_id: evento_id || null,
    });
  } catch (e) {
    console.error('[audit]', e.message);
  }
}

/** Apenas verifica a conexão (não semeia mais nada — eventos já populados). */
async function init() {
  unwrap(await sb().from('eventos').select('id', { count: 'exact', head: true }));
}

module.exports = { sb, repo, audit, init, normalize, newId };
