'use strict';
/**
 * Importador das listas de credenciamento (uso único, fora do runtime do app).
 * Lê os xlsx em dados-uteis/, classifica tipo, extrai quem convidou, monta
 * dados_extra (todas as colunas originais) e insere no Supabase por evento.
 *
 * Requer: SUPABASE_URL e SUPABASE_KEY no ambiente. Insere direto via supabase-js
 * (precisa de policy de insert ativa, ou RLS desligado, durante a execução).
 *
 * Eventos: imersao | clinica-d1 | clinica-d2 (Clínica replicada nos 2 dias).
 */
const XLSX = require('xlsx');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const DIR = 'c:/Users/infra/Downloads/credenciamento-thb/dados-uteis';
const FILE_CLINICA = 'Credenciamento Clínica.xlsx';
const FILE_IMERSAO = 'Credenciamento Imersão.xlsx';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY;
if (!url || !key) { console.error('Defina SUPABASE_URL e SUPABASE_KEY'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 20);
const digits = (s) => String(s == null ? '' : s).replace(/\D/g, '');
const str = (s) => (s == null ? '' : String(s)).trim();
const cut = (s, n) => str(s).slice(0, n);

function rows(file, sheet) {
  const wb = XLSX.readFile(`${DIR}/${file}`);
  const ws = wb.Sheets[sheet];
  if (!ws) { console.error('Aba não encontrada:', file, sheet); return []; }
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

function classify(instrucao, convidadoPor) {
  const i = str(instrucao).toUpperCase();
  if (/DIAMANTE/.test(i)) return 'diamante';
  if (/S[ÓO]CIO/.test(i)) return 'socio';
  if (str(convidadoPor)) return 'convidado';
  return 'comum';
}

// chave de dedupe: documento (dígitos) > email > nome
function dedupeKey(p) {
  return digits(p.documento) || str(p.email).toLowerCase() || str(p.nome).toLowerCase();
}

function base(evento, p) {
  const id = `${evento}-${sha(p.__key || dedupeKey(p) || Math.random())}`;
  return {
    id,
    evento_id: evento,
    nome: cut(p.nome, 255),
    nomeCracha: cut(p.nomeCracha, 255),
    email: cut(p.email, 255),
    telefone: cut(p.telefone, 64),
    documento: str(p.documento),
    cidade: str(p.cidade),
    estado: cut(p.estado, 64),
    turma: cut(p.turma, 32),
    profissao: cut(p.profissao, 255),
    instrucao: cut(p.instrucao, 128),
    nivel: str(p.nivel),
    faturamento: str(p.faturamento),
    tamanhoCamisa: cut(p.tamanhoCamisa, 16),
    tipo: p.tipo,
    grupoDiamante: str(p.grupoDiamante) || null,
    convidadoPor: str(p.convidadoPor) || null,
    observacoes: '',
    recebeuCracha: false,
    credenciado: false,
    dataCredenciamento: '',
    foto: '',
    dados_extra: p.dados_extra || null,
  };
}

/* ---------------- IMERSÃO ---------------- */
function buildImersao() {
  const out = [];
  for (const r of rows(FILE_IMERSAO, 'Credenciamento - Compradores')) {
    if (!str(r['Nome'])) continue;
    const convidadoPor = r['Nome da pessoa que indicou'];
    out.push(base('imersao', {
      nome: r['Nome'], email: r['Email'], documento: r['Documento'], telefone: r['Telefone'],
      cidade: r['Cidade'], estado: r['Estado'], turma: r['Turma'], profissao: r['Profissão'],
      instrucao: r['Instrução'], nivel: r['Nível em Holding'], faturamento: r['Faturamento mensal'],
      convidadoPor, tipo: classify(r['Instrução'], convidadoPor), dados_extra: r,
    }));
  }
  for (const r of rows(FILE_IMERSAO, 'Sócios')) {
    const nome = r['Nome do sócio'];
    if (!str(nome)) continue;
    out.push(base('imersao', {
      nome, email: r['Email do sócio'], documento: r['Documento do sócio'], telefone: r['Telefone do sócio'],
      convidadoPor: r['Nome'], tipo: 'socio', dados_extra: r,
    }));
  }
  for (const r of rows(FILE_IMERSAO, 'Credenciamento - Diamantes')) {
    if (!str(r['Nome completo'])) continue;
    out.push(base('imersao', {
      nome: r['Nome completo'], email: r['E-mail'], telefone: r['Telefone (WhatsApp)'],
      grupoDiamante: r['Qual é o seu grupo'], tipo: 'diamante', dados_extra: r,
    }));
  }
  return out;
}

/* ---------------- CLÍNICA (uma lista, replicada nos 2 dias) ---------------- */
function buildClinicaRaw() {
  const raw = [];
  for (const r of rows(FILE_CLINICA, 'Credenciamento - Compradores')) {
    if (!str(r['Nome'])) continue;
    raw.push({
      nome: r['Nome'], email: r['Email'], documento: r['Documento'], telefone: r['Telefone'],
      cidade: r['Cidade'], estado: r['Estado'], turma: r['Turma'], profissao: r['Profissão'],
      instrucao: r['Instrução'],
      nivel: r['Selecione o seu nível atual com o trabalho com Holding Familiar'],
      faturamento: r['Faturamento no trabalho com Holding Familiar.'],
      tamanhoCamisa: r['Selecione o tamanho da sua camisa'],
      nomeCracha: r['Nome do seu crachá'],
      tipo: classify(r['Instrução'], null), dados_extra: r,
    });
  }
  for (const r of rows(FILE_CLINICA, 'Credenciamento - Diamantes')) {
    if (!str(r['Nome completo'])) continue;
    raw.push({
      nome: r['Nome completo'], email: r['E-mail'], telefone: r['Telefone (WhatsApp)'],
      turma: r['Turma'], tamanhoCamisa: r['Camisa'],
      grupoDiamante: r['Qual é o seu grupo'], tipo: 'diamante', dados_extra: r,
    });
  }
  return raw;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((p) => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
}

async function insertAll(evento, list) {
  const uniq = dedupe(list);
  for (let i = 0; i < uniq.length; i += 500) {
    const batch = uniq.slice(i, i + 500);
    const { error } = await sb.from('participantes').upsert(batch, { onConflict: 'id', ignoreDuplicates: true });
    if (error) { console.error(`[${evento}] lote ${i}: ${error.message}`); process.exit(1); }
  }
  const byTipo = uniq.reduce((m, p) => ((m[p.tipo] = (m[p.tipo] || 0) + 1), m), {});
  console.log(`[${evento}] inseridos ${uniq.length} (brutos ${list.length}) — ${JSON.stringify(byTipo)}`);
}

(async () => {
  const imersao = buildImersao();
  const clinicaRaw = buildClinicaRaw();
  const d1 = clinicaRaw.map((p) => base('clinica-d1', p));
  const d2 = clinicaRaw.map((p) => base('clinica-d2', p));
  await insertAll('imersao', imersao);
  await insertAll('clinica-d1', d1);
  await insertAll('clinica-d2', d2);
  console.log('OK');
})();
