'use strict';

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

let client = null;

// Grupo do evento: a Clínica (D1/D2) compartilha o token; a Imersão tem o seu.
function grupoDe(eventoId) {
  const e = String(eventoId || '');
  // Dias do mesmo evento compartilham o QR: "base-d1", "base-d2"... -> "base".
  // (cobre clinica-d1/d2, diamantes-d1/d2 e qualquer evento de vários dias criado na tela)
  const m = e.match(/^(.+)-d\d+$/);
  if (m) return m[1];
  return e || 'geral';
}
// Token da pessoa POR GRUPO: o mesmo nos dois dias da Clínica, mas diferente entre
// Imersão e Clínica (links distintos + um QR só vale no seu grupo). Deriva de
// documento (só dígitos) > e-mail > nome.
function tokenDe(grupo, { documento, email, nome }) {
  const doc = String(documento || '').replace(/\D/g, '');
  const key = doc || String(email || '').trim().toLowerCase() || String(nome || '').trim().toLowerCase();
  if (!key) return null;
  return crypto.createHash('sha1').update(`${grupo}|${key}`).digest('hex').slice(0, 24);
}

// Chave natural que identifica A MESMA PESSOA num evento (base do dedup do import).
// Prioridade e-mail > documento > nome: o e-mail é único por pessoa, enquanto o
// documento pode ser um CNPJ compartilhado por sócios (dois participantes distintos
// com o mesmo CNPJ) — usar o documento primeiro colidiria esses cadastros num só.
// (Difere de propósito do pessoa_token, que segue documento>e-mail para não
// invalidar os QR já emitidos/impressos.)
function chaveNatural({ email, documento, nome }) {
  const em = String(email || '').trim().toLowerCase();
  if (em) return `e:${em}`;
  const doc = String(documento || '').replace(/\D/g, '');
  if (doc) return `d:${doc}`;
  const nm = String(nome || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (nm) return `n:${nm}`;
  return null;
}
// id DETERMINÍSTICO do registro por evento: mesma pessoa reimportada = mesmo id,
// então o import faz upsert (on conflict id) em vez de criar duplicata. Estável
// entre reenvios do mesmo CSV, do CSV + gente a mais, e do arquivo consolidado.
function idNatural(eventoId, pessoa) {
  const ch = chaveNatural(pessoa);
  if (!ch) return null;
  const h = crypto.createHash('sha1').update(ch).digest('hex').slice(0, 20);
  return `${String(eventoId || 'geral')}-${h}`;
}

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
// Charset seguro para código lido do QR (token hex ou id gerado/importado).
// Vírgulas/parênteses quebrariam o filtro .or() do PostgREST — QR desconhecido
// com esses caracteres deve virar "não encontrado", nunca erro 500.
const CODE_RE = /^[A-Za-z0-9_.:@-]{1,64}$/;
const codeSeguro = (c) => (CODE_RE.test(String(c || '')) ? String(c) : null);
// Colunas leves da listagem (sem foto nem dados_extra).
const LIGHT = 'id,evento_id,nome,nomeCracha,email,telefone,documento,cidade,estado,turma,profissao,instrucao,faturamento,tipo,grupoDiamante,convidadoPor,tamanhoCamisa,grupo,pessoa_token,recebeuCracha,credenciado,dataCredenciamento,temFoto,dados_extra,representante,updated_at';
// Colunas do detalhe (tudo exceto a foto, que é carregada à parte).
const DETALHE = 'id,evento_id,nome,nomeCracha,email,telefone,documento,cidade,estado,turma,profissao,instrucao,nivel,faturamento,tamanhoCamisa,grupo,tipo,grupoDiamante,convidadoPor,convidadoPorId,observacoes,dataChegada,dataRetorno,dataCredenciamento,recebeuCracha,credenciado,pessoa_token,dados_extra,representante,temFoto,criado_em,updated_at';

function shape(r) {
  if (!r) return r;
  return { ...r, recebeuCracha: !!r.recebeuCracha, credenciado: !!r.credenciado, temFoto: !!r.temFoto };
}

/* ---------- Normalização (criação/edição manual) ---------- */
// Representante: quem participa/recebe o e-mail no lugar do comprador (opt-in
// manual). Guarda um objeto enxuto ou null (limpa quando desmarcado/incompleto).
function normalizeRep(r) {
  if (!r || typeof r !== 'object') return null;
  const s = (v) => (v == null ? '' : String(v)).trim().slice(0, 255);
  const nome = s(r.nome); const email = s(r.email);
  if (!nome && !email) return null; // sem nome nem e-mail não é um representante válido
  return { nome, email, telefone: s(r.telefone), documento: s(r.documento) || null };
}

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
    grupo: p.grupo == null || p.grupo === '' ? null : String(p.grupo),
    tipo: ['comum', 'socio', 'diamante', 'convidado'].includes(p.tipo) ? p.tipo : 'comum',
    grupoDiamante: p.grupoDiamante ? String(p.grupoDiamante) : null,
    convidadoPor: p.convidadoPor ? String(p.convidadoPor) : null,
    observacoes: p.observacoes == null ? '' : String(p.observacoes),
    foto: p.foto == null ? '' : String(p.foto),
    pessoa_token: p.pessoa_token || tokenDe(grupoDe(p.evento_id), { documento: p.documento, email: p.email, nome }),
    dados_extra: p.dados_extra && typeof p.dados_extra === 'object' ? p.dados_extra : null,
    representante: normalizeRep(p.representante),
  };
}

function newId() {
  return 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

const repo = {
  async listarEventos() {
    return unwrap(await sb().from('vw_eventos').select('*').order('ordem', { ascending: true }));
  },

  async criarEvento(ev) {
    const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    const nome = String(ev.nome || '').slice(0, 200).trim();
    if (!nome) return null;
    const id = (String(ev.id || '').trim() || `${slug(nome)}-${Date.now().toString(36).slice(-4)}`).slice(0, 64);
    const row = {
      id, nome,
      tipo: ['imersao', 'clinica', 'passado'].includes(ev.tipo) ? ev.tipo : 'clinica',
      ordem: Number(ev.ordem) || 0, data: ev.data || null,
      ativo: ev.ativo !== false, arquivado: !!ev.arquivado,
    };
    return unwrap(await sb().from('eventos').insert(row).select('*').single());
  },

  async atualizarEvento(id, ev) {
    const campos = {};
    for (const k of ['nome', 'tipo', 'ordem', 'data', 'ativo', 'arquivado']) if (k in ev) campos[k] = ev[k];
    const data = unwrap(await sb().from('eventos').update(campos).eq('id', id).select('*'));
    return data[0] || null;
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

  // Resolve a pessoa pelo código (token OU id) DENTRO de um evento/dia.
  async porToken(eventoId, code) {
    code = codeSeguro(code);
    if (!eventoId || !code) return null;
    const data = unwrap(await sb().from(TABELA).select(DETALHE).eq('evento_id', eventoId)
      .or(`pessoa_token.eq.${code},id.eq.${code}`).limit(1));
    return data.length ? shape(data[0]) : null;
  },
  // Localiza a pessoa em QUALQUER evento (para identificar quando o dia está errado).
  async localizar(code) {
    code = codeSeguro(code);
    if (!code) return [];
    return unwrap(await sb().from(TABELA).select('id,nome,evento_id').or(`pessoa_token.eq.${code},id.eq.${code}`));
  },
  // Nome + evento para a página pública do QR (inclui o nome real do evento).
  async infoPorToken(token) {
    if (!token) return null;
    const data = unwrap(await sb().from(TABELA).select('nome,evento_id').eq('pessoa_token', token).limit(1));
    if (!data.length) return null;
    const info = data[0];
    try {
      const ev = unwrap(await sb().from('eventos').select('nome').eq('id', info.evento_id).limit(1));
      if (ev.length) info.evento_nome = ev[0].nome;
    } catch { /* segue sem o nome do evento */ }
    return info;
  },

  // Estado leve da lista (máx updated_at + contagem) — base do delta-polling:
  // se nada mudou desde o último poll, o servidor responde "unchanged" em bytes.
  async estadoLista(eventoId) {
    const { data, error, count } = await sb().from(TABELA)
      .select('updated_at', { count: 'exact' })
      .eq('evento_id', eventoId)
      .order('updated_at', { ascending: false }).limit(1);
    if (error) throw new Error(error.message || 'supabase_error');
    return { updatedAt: data && data.length ? data[0].updated_at : null, count: count || 0 };
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
      convidadoPor: row.convidadoPor, observacoes: row.observacoes, representante: row.representante,
      updated_at: new Date().toISOString(),
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

  // Marca/desmarca "possível comprador" — sinal de perfil que a equipe alimenta
  // à mão (não é derivado). Fica em dados_extra.possivel_comprador (jsonb, sem
  // migração de schema) e é PRESERVADO no re-import (ver campos protegidos).
  // Escopo: a MESMA PESSOA nos 3 dias — propaga por pessoa_token, então marcar no
  // check-in de qualquer dia reflete nos demais (análise de perfil é da pessoa,
  // não do dia). Devolve os registros afetados (para o cliente atualizar a lista).
  async marcarComprador(id, valor) {
    const alvo = unwrap(await sb().from(TABELA).select('id,nome,evento_id,pessoa_token,dados_extra').eq('id', id));
    if (!alvo.length) return null;
    const { pessoa_token: token, nome, evento_id } = alvo[0];
    const patch = { updated_at: new Date().toISOString() };
    // Guarda a flag dentro de dados_extra sem tocar nas demais chaves: como o
    // supabase-js não faz merge de jsonb, lemos e reescrevemos por registro.
    // Sem pessoa_token (linha legada), afeta só este id — mas SEMPRE com o
    // dados_extra real em mãos, para não apagar 'lote' e demais chaves.
    const alvos = token
      ? unwrap(await sb().from(TABELA).select('id,dados_extra').eq('pessoa_token', token))
      : alvo.map((r) => ({ id: r.id, dados_extra: r.dados_extra }));
    const ids = [];
    for (const r of alvos) {
      const de = { ...(r.dados_extra && typeof r.dados_extra === 'object' ? r.dados_extra : {}) };
      if (valor) de.possivel_comprador = true; else delete de.possivel_comprador;
      unwrap(await sb().from(TABELA).update({ ...patch, dados_extra: de }).eq('id', r.id));
      ids.push(r.id);
    }
    return { nome, evento_id, valor: !!valor, ids };
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
    // Consultas separadas (sem .or): e-mail/documento com vírgula ou parêntese
    // quebraria a sintaxe de filtro do PostgREST.
    const SEL = 'id,evento_id,credenciado,dataCredenciamento';
    const achados = new Map();
    if (doc) {
      unwrap(await sb().from(TABELA).select(SEL).eq('documento', chaves.documento))
        .forEach((r) => achados.set(r.id, r));
    }
    if (email) {
      unwrap(await sb().from(TABELA).select(SEL).ilike('email', email))
        .forEach((r) => achados.set(r.id, r));
    }
    return [...achados.values()].map((r) => ({ ...r, credenciado: !!r.credenciado }));
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

  // Campos que NUNCA são sobrescritos ao reimportar uma pessoa já existente:
  // o credenciamento e o que o operador produziu na hora do evento têm precedência
  // sobre a planilha (que só descreve a lista de convidados).
  //  - credenciado/recebeuCracha/dataCredenciamento: estado do balcão
  //  - foto/temFoto: foto tirada na hora
  //  - representante: opt-in manual feito na UI
  //  - dados_extra.lote: marcação de disparo (Active Campaign), invisível na planilha
  //  - dados_extra.possivel_comprador: sinal de perfil marcado pela equipe no evento
  // (o merge em aAtualizar dá precedência ao dados_extra do banco → tudo isso sobrevive)

  // Prepara as linhas do import: aplica id determinístico por pessoa (dedup do
  // próprio arquivo incluído) e retorna também a chave natural de cada uma.
  _prepararImport(eventoId, list) {
    const porId = new Map();
    for (const p of list) {
      const id = idNatural(eventoId, p) || newId(); // sem chave (nem nome) → id próprio
      const row = normalize({ ...p, id, evento_id: eventoId });
      if (!row) continue;
      // Se o MESMO arquivo trouxer a pessoa 2x, a última linha vence (idempotente).
      porId.set(row.id, row);
    }
    return [...porId.values()];
  },

  // Importa lista de UM evento.
  // modo:
  //  - 'substituir'  : apaga tudo do evento e insere a lista (destrutivo — perde
  //                    credenciamento/foto/representante). Use só para carga inicial.
  //  - 'adicionar'   : upsert (não duplica), preservando os campos protegidos de quem
  //                    já existe. Não remove ninguém.
  //  - 'sincronizar' : igual a 'adicionar' + reporta quem está no banco mas ficou fora
  //                    do arquivo (órfãos); NÃO apaga órfãos (mais seguro manter).
  async importarLista(eventoId, list, modo = 'substituir') {
    if (!eventoId) throw new Error('evento_obrigatorio');
    // Normaliza ANTES de apagar: se a lista vier inválida, o evento não é perdido.
    const rows = this._prepararImport(eventoId, list);

    if (modo === 'substituir') {
      if (!rows.length) throw new Error('lista_vazia');
      unwrap(await sb().from(TABELA).delete().eq('evento_id', eventoId));
      for (let i = 0; i < rows.length; i += 500) {
        unwrap(await sb().from(TABELA).insert(rows.slice(i, i + 500)));
      }
      return { total: rows.length, inseridos: rows.length, atualizados: 0, inalterados: 0, orfaos: 0 };
    }

    // 'adicionar' / 'sincronizar': upsert idempotente preservando o que veio do balcão.
    const existentes = new Map(); // id -> registro atual (campos protegidos)
    {
      const atuais = unwrap(await sb().from(TABELA)
        .select('id,credenciado,recebeuCracha,dataCredenciamento,foto,temFoto,representante,dados_extra')
        .eq('evento_id', eventoId));
      for (const r of atuais) existentes.set(r.id, r);
    }

    const aInserir = [];
    const aAtualizar = [];
    for (const row of rows) {
      const cur = existentes.get(row.id);
      if (!cur) { aInserir.push(row); continue; }
      // Mescla: a planilha atualiza dados de cadastro, mas o balcão manda no resto.
      aAtualizar.push({
        ...row,
        credenciado: cur.credenciado,
        recebeuCracha: cur.recebeuCracha,
        dataCredenciamento: cur.dataCredenciamento,
        foto: cur.foto,
        temFoto: cur.temFoto,
        // representante feito na UI só é mantido; a planilha não o apaga.
        representante: cur.representante || row.representante || null,
        // preserva o 'lote' (e qualquer chave de controle já gravada) por cima do novo.
        dados_extra: { ...(row.dados_extra || {}), ...(cur.dados_extra || {}) },
        updated_at: new Date().toISOString(),
      });
    }

    for (let i = 0; i < aInserir.length; i += 500) {
      unwrap(await sb().from(TABELA).insert(aInserir.slice(i, i + 500)));
    }
    for (const row of aAtualizar) {
      const { id, ...campos } = row;
      unwrap(await sb().from(TABELA).update(campos).eq('id', id));
    }

    const idsArquivo = new Set(rows.map((r) => r.id));
    const orfaos = [...existentes.keys()].filter((id) => !idsArquivo.has(id)).length;
    return {
      total: rows.length,
      inseridos: aInserir.length,
      atualizados: aAtualizar.length,
      inalterados: 0,
      orfaos,
    };
  },

  // Dry-run: reconcilia o arquivo contra o banco SEM gravar nada. Base da prévia
  // que o operador aprova antes de aplicar. Detecta também possíveis duplicatas
  // dentro do próprio arquivo (mesma pessoa, cadastros diferentes).
  async previaImport(eventoId, list) {
    if (!eventoId) throw new Error('evento_obrigatorio');
    // Conta quantas linhas de entrada caem na mesma chave (duplicata no arquivo).
    const porChave = new Map();
    for (const p of list) {
      if (!String(p.nome || '').trim()) continue;
      const ch = chaveNatural(p) || `x:${Math.random()}`;
      const g = porChave.get(ch) || [];
      g.push(p);
      porChave.set(ch, g);
    }
    const duplicatasArquivo = [...porChave.values()]
      .filter((g) => g.length > 1)
      .map((g) => ({ chave: chaveNatural(g[0]), nomes: g.map((x) => String(x.nome || '').trim()) }));

    const rows = this._prepararImport(eventoId, list);
    const idsBanco = new Set(
      unwrap(await sb().from(TABELA).select('id').eq('evento_id', eventoId)).map((r) => r.id),
    );
    const idsArquivo = new Set(rows.map((r) => r.id));
    let novos = 0; let atualizados = 0;
    for (const r of rows) (idsBanco.has(r.id) ? (atualizados++) : (novos++));
    const orfaos = [...idsBanco].filter((id) => !idsArquivo.has(id)).length;
    return {
      totalArquivo: rows.length,
      novos,
      atualizados,
      orfaos, // no banco mas fora do arquivo (não serão apagados)
      duplicatasArquivo, // mesma pessoa repetida no arquivo → serão fundidas
    };
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

module.exports = { repo, audit, init };
