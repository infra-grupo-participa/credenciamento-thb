#!/usr/bin/env node
/**
 * Importa as planilhas de pesquisa/NPS do ETHB para o card do participante.
 *
 * COMO USAR (o NPS roda todo dia; a pesquisa, uma vez só):
 *
 *   node dados-uteis/importar-pesquisa-nps.js --evento ethb-sp-d3 \
 *     --cracha "…/Crachá - compradores.csv" \
 *     --cracha "…/Crachá - Diamantes.csv" \
 *     --pesquisa "…/Pesquisa ETHB.csv" \
 *     --nps1 "…/NPS dia 1.csv"
 *
 *   --nps1 / --nps2 / --nps3 conforme o dia. Rodar de novo o MESMO arquivo é
 *   seguro: a gravação é por (participante, tipo), então reimportar corrige em
 *   vez de duplicar.
 *
 *   --dry para simular sem gravar nada. SEMPRE rode com --dry primeiro.
 *
 * POR QUE ESTE SCRIPT EXISTE em vez de uma tela de upload: ele roda uma vez por
 * dia, na mão de quem organiza o evento, e uma tela de import custaria mais
 * código e mais superfície de erro do que vale — sem contar o egress de subir
 * tudo pelo app. Se um dia virar rotina de outra pessoa, aí sim vira tela.
 *
 * MATCHING (em cascata, do mais forte para o mais fraco):
 *   1. e-mail normalizado
 *   2. telefone canônico (DDD + 8 últimos dígitos — mesmo critério do CNHF,
 *      que resolve o 9º dígito entrando e saindo)
 *   3. nome normalizado (sem acento, minúsculo, espaços colapsados)
 *
 * O NPS só traz NOME, então ali a cascata para no passo 3 — e é por isso que
 * existe a tabela `import_nao_casado`: o que não casar fica REGISTRADO em vez
 * de sumir. Uma resposta perdida em silêncio viraria um número errado na tela
 * sem ninguém saber.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
require('dotenv/config');
const { createClient } = require('@supabase/supabase-js');

/* ---------------- CSV ---------------- */
// Parser próprio: os cabeçalhos destas planilhas têm vírgula e quebra de linha
// DENTRO das aspas (as perguntas são frases inteiras), então split(',') não serve.
function parseCsv(texto) {
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  const t = texto.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  if (!linhas.length) return [];
  const cab = linhas[0].map((h) => h.trim());
  return linhas.slice(1)
    .filter((l) => l.some((c) => (c || '').trim()))
    .map((l) => Object.fromEntries(cab.map((h, i) => [h, (l[i] ?? '').trim()])));
}

/* ---------------- normalização ---------------- */
const semAcento = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s) => semAcento(String(s || '')).toLowerCase().replace(/\s+/g, ' ').trim();
const digitos = (s) => String(s || '').replace(/\D/g, '');
function foneCanon(s) {
  const d = digitos(s);
  if (d.length < 10) return '';
  const n = d.length > 11 ? d.slice(-11) : d;
  return n.slice(0, 2) + n.slice(-8);
}
const simNao = (v) => {
  const s = norm(v);
  if (!s || s === '-') return null;
  if (s.startsWith('sim')) return true;
  if (s.startsWith('nao')) return false;
  return null;
};
// Acha a coluna pelo pedaço do texto: os cabeçalhos são frases longas e mudam
// de planilha para planilha ("Nome" x "Nome completo" x "Qual o seu nome…").
const acha = (linha, ...pedacos) => {
  for (const k of Object.keys(linha)) {
    const n = norm(k);
    if (pedacos.some((p) => n.includes(norm(p)))) return k;
  }
  return null;
};

/* ---------------- score do lead ---------------- */
// Fórmula deliberadamente simples e legível: o objetivo é o operador bater o
// olho no balcão e saber com quem vale puxar conversa. Ajustar os pesos aqui é
// mais barato do que discutir modelo — e o breakdown vai junto para a tela
// poder explicar POR QUE alguém está quente.
const PESOS = {
  possivel_comprador: 25,
  possivel_aurum: 25,
  possivel_renov_aurum: 15,
  possivel_hm: 10,
  possivel_renov_hm: 10,
  pesquisa: 10,
  nps: 5,
  ingresso_diamond: 10,
  ingresso_vip: 5,
};

function calcularScore({ sinal, pesquisaOk, temNps }) {
  let n = 0;
  if (sinal) {
    if (sinal.possivel_comprador) n += PESOS.possivel_comprador;
    if (sinal.possivel_aurum) n += PESOS.possivel_aurum;
    if (sinal.possivel_renov_aurum) n += PESOS.possivel_renov_aurum;
    if (sinal.possivel_hm) n += PESOS.possivel_hm;
    if (sinal.possivel_renov_hm) n += PESOS.possivel_renov_hm;
    const ing = norm(sinal.ingresso);
    if (ing === 'diamond') n += PESOS.ingresso_diamond;
    else if (ing === 'vip') n += PESOS.ingresso_vip;
  }
  // Engajamento: quem parou para responder está mais perto da conversa.
  if (pesquisaOk) n += PESOS.pesquisa;
  if (temNps) n += PESOS.nps;
  return Math.max(0, Math.min(100, n));
}

/* ---------------- args ---------------- */
function args() {
  const a = process.argv.slice(2);
  const o = { cracha: [], dry: false };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--dry') o.dry = true;
    else if (k === '--evento') o.evento = a[++i];
    else if (k === '--cracha') o.cracha.push(a[++i]);
    else if (k === '--pesquisa') o.pesquisa = a[++i];
    else if (k === '--nps1') o.nps1 = a[++i];
    else if (k === '--nps2') o.nps2 = a[++i];
    else if (k === '--nps3') o.nps3 = a[++i];
  }
  return o;
}

/* ---------------- principal ---------------- */
async function main() {
  const o = args();
  if (!o.evento) {
    console.error('Falta --evento (ex.: --evento ethb-sp-d3). Use --dry para simular.');
    process.exit(1);
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (.env do projeto).');
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  console.log(`evento: ${o.evento}${o.dry ? '   [DRY-RUN: nada será gravado]' : ''}`);

  // ---- índice dos participantes do evento ----
  const { data: parts, error } = await sb
    .from('participantes')
    .select('id,nome,email,telefone')
    .eq('evento_id', o.evento);
  if (error) throw new Error(error.message);
  console.log(`participantes no evento: ${parts.length}`);

  const porEmail = new Map(), porFone = new Map(), porNome = new Map();
  for (const p of parts) {
    const e = norm(p.email); if (e) porEmail.set(e, p.id);
    const f = foneCanon(p.telefone); if (f) porFone.set(f, p.id);
    const n = norm(p.nome); if (n && !porNome.has(n)) porNome.set(n, p.id);
  }
  const casar = ({ email, telefone, nome }) =>
    (email && porEmail.get(norm(email))) ||
    (telefone && porFone.get(foneCanon(telefone))) ||
    (nome && porNome.get(norm(nome))) ||
    null;

  const sinais = new Map();     // id -> sinal
  const respostas = [];         // {participante_id, tipo, respostas, nota, respondido_em}
  const naoCasou = [];
  const pesquisaPorId = new Set();
  const npsPorId = new Set();

  const lerCsv = (p) => parseCsv(fs.readFileSync(p, 'utf8'));

  // ---- crachá: sinais comerciais + flags de quem respondeu ----
  for (const arq of o.cracha) {
    const linhas = lerCsv(arq);
    if (!linhas.length) continue;
    const l0 = linhas[0];
    const cNome = acha(l0, 'nome completo', 'nome');
    const cEmail = acha(l0, 'e-mail', 'email');
    const cFone = acha(l0, 'telefone', 'whatsapp');
    const cIng = acha(l0, 'ingresso');
    const cOrigem = acha(l0, 'origem', 'instrucao');
    const cTurma = acha(l0, 'turma');
    const cGrupo = acha(l0, 'qual e o seu grupo', 'seu grupo');
    const cComprador = acha(l0, 'possivel comprador');
    const cAurum = acha(l0, 'possivel aurum');
    const cRenovAurum = acha(l0, 'possivel renovacao aurum');
    const cHm = acha(l0, 'possivel hm');
    const cRenovHm = acha(l0, 'possivel renovacao hm');
    const cSocio = acha(l0, 'vai sozinho');
    const cPesq = acha(l0, 'respondeu a pesquisa', 'respondeu pesquisa');

    let ok = 0;
    for (const r of linhas) {
      const id = casar({ email: cEmail && r[cEmail], telefone: cFone && r[cFone], nome: cNome && r[cNome] });
      if (!id) {
        naoCasou.push({ origem: path.basename(arq), nome: cNome && r[cNome], email: cEmail && r[cEmail], telefone: cFone && r[cFone], carga: r });
        continue;
      }
      ok++;
      sinais.set(id, {
        participante_id: id,
        ingresso: (cIng && r[cIng]) || null,
        origem: (cOrigem && r[cOrigem]) || null,
        turma: (cTurma && r[cTurma]) || null,
        grupo_diamante: (cGrupo && r[cGrupo]) || null,
        possivel_comprador: cComprador ? simNao(r[cComprador]) : null,
        possivel_aurum: cAurum ? simNao(r[cAurum]) : null,
        possivel_renov_aurum: cRenovAurum ? simNao(r[cRenovAurum]) : null,
        possivel_hm: cHm ? simNao(r[cHm]) : null,
        possivel_renov_hm: cRenovHm ? simNao(r[cRenovHm]) : null,
        socio_vai_sozinho: (cSocio && r[cSocio]) || null,
      });
      if (cPesq && simNao(r[cPesq])) pesquisaPorId.add(id);
    }
    console.log(`  crachá ${path.basename(arq)}: ${ok}/${linhas.length} casaram`);
  }

  // ---- respostas (pesquisa e NPS) ----
  const blocos = [
    ['pesquisa', o.pesquisa],
    ['nps_d1', o.nps1],
    ['nps_d2', o.nps2],
    ['nps_d3', o.nps3],
  ].filter(([, arq]) => arq);

  for (const [tipo, arq] of blocos) {
    const linhas = lerCsv(arq);
    if (!linhas.length) continue;
    const l0 = linhas[0];
    const cNome = acha(l0, 'nome completo', 'seu nome', 'nome');
    const cFone = acha(l0, 'whatsapp', 'telefone');
    const cEmail = acha(l0, 'e-mail', 'email');
    const cData = acha(l0, 'data');
    // A nota do NPS é a pergunta da escala 0-10 (o texto é longo e quebra linha).
    const cNota = acha(l0, 'de zero a dez', 'chance de voce indicar');
    // Colunas de controle do formulário não são resposta e não vão para a tela.
    const ignorar = new Set([cNome, cFone, cEmail, cData, acha(l0, 'pontuacao'), acha(l0, 'id')].filter(Boolean));

    let ok = 0;
    for (const r of linhas) {
      const id = casar({ email: cEmail && r[cEmail], telefone: cFone && r[cFone], nome: cNome && r[cNome] });
      if (!id) {
        naoCasou.push({ origem: `${tipo}:${path.basename(arq)}`, nome: cNome && r[cNome], email: cEmail && r[cEmail], telefone: cFone && r[cFone], carga: r });
        continue;
      }
      ok++;
      const corpo = {};
      for (const [k, v] of Object.entries(r)) {
        if (ignorar.has(k)) continue;
        if (v && String(v).trim()) corpo[k] = v;
      }
      let nota = null;
      if (cNota) {
        const m = digitos(r[cNota]);
        if (m !== '') { const x = Number(m); if (x >= 0 && x <= 10) nota = x; }
      }
      let quando = null;
      if (cData && r[cData]) { const d = new Date(r[cData]); if (!isNaN(d)) quando = d.toISOString(); }

      respostas.push({ participante_id: id, tipo, respostas: corpo, nota, respondido_em: quando });
      if (tipo === 'pesquisa') pesquisaPorId.add(id);
      else npsPorId.add(id);
    }
    console.log(`  ${tipo} ${path.basename(arq)}: ${ok}/${linhas.length} casaram`);
  }

  // ---- score ----
  const scores = new Map();
  for (const p of parts) {
    const s = sinais.get(p.id) || null;
    const score = calcularScore({ sinal: s, pesquisaOk: pesquisaPorId.has(p.id), temNps: npsPorId.has(p.id) });
    scores.set(p.id, score);
  }

  const faixa = (n) => (n >= 80 ? 'muito quente' : n >= 60 ? 'quente' : n >= 30 ? 'morno' : 'frio');
  const dist = { 'muito quente': 0, quente: 0, morno: 0, frio: 0 };
  for (const n of scores.values()) dist[faixa(n)]++;

  console.log('\nRESUMO');
  console.log(`  sinais comerciais .... ${sinais.size}`);
  console.log(`  respostas ............ ${respostas.length}`);
  console.log(`  responderam pesquisa . ${pesquisaPorId.size}`);
  console.log(`  não casaram .......... ${naoCasou.length}`);
  console.log(`  distribuição do lead . muito quente=${dist['muito quente']} quente=${dist.quente} morno=${dist.morno} frio=${dist.frio}`);

  if (o.dry) {
    console.log('\n[DRY-RUN] nada foi gravado. Rode sem --dry para aplicar.');
    if (naoCasou.length) {
      console.log('\nAmostra do que não casou (confira antes de aplicar):');
      for (const x of naoCasou.slice(0, 8)) console.log(`  - [${x.origem}] ${x.nome || '(sem nome)'}`);
    }
    return;
  }

  // ---- gravação ----
  const lotes = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

  if (sinais.size) {
    for (const l of lotes([...sinais.values()], 200)) {
      const { error } = await sb.from('participante_sinal')
        .upsert(l.map((s) => ({ ...s, atualizado_em: new Date().toISOString() })), { onConflict: 'participante_id' });
      if (error) throw new Error('sinais: ' + error.message);
    }
    console.log(`sinais gravados: ${sinais.size}`);
  }

  if (respostas.length) {
    for (const l of lotes(respostas, 200)) {
      const { error } = await sb.from('participante_resposta')
        .upsert(l, { onConflict: 'participante_id,tipo' });
      if (error) throw new Error('respostas: ' + error.message);
    }
    console.log(`respostas gravadas: ${respostas.length}`);
  }

  // Score e flag no participante. Só grava quem MUDOU: cada update mexe em
  // `updated_at`, e updated_at em massa faria todo aparelho no balcão rebaixar a
  // lista inteira no poll seguinte — exatamente o que a otimização de egress
  // evita. Reimportar sem novidade tem de custar zero.
  const atualiza = [];
  for (const p of parts) {
    const score = scores.get(p.id) || 0;
    const ok = pesquisaPorId.has(p.id);
    atualiza.push({ id: p.id, score, ok });
  }
  const { data: atuais } = await sb.from('participantes')
    .select('id,pesquisa_ok,lead_score').eq('evento_id', o.evento);
  const mapaAtual = new Map((atuais || []).map((r) => [r.id, r]));
  const mudou = atualiza.filter((a) => {
    const cur = mapaAtual.get(a.id);
    return !cur || !!cur.pesquisa_ok !== a.ok || Number(cur.lead_score) !== a.score;
  });

  for (const l of lotes(mudou, 100)) {
    await Promise.all(l.map((a) =>
      sb.from('participantes')
        .update({ pesquisa_ok: a.ok, lead_score: a.score, updated_at: new Date().toISOString() })
        .eq('id', a.id)
    ));
  }
  console.log(`participantes atualizados: ${mudou.length} (de ${atualiza.length} — os demais já estavam corretos)`);

  if (naoCasou.length) {
    for (const l of lotes(naoCasou.map((x) => ({ ...x, evento_id: o.evento })), 200)) {
      const { error } = await sb.from('import_nao_casado').insert(l);
      if (error) console.error('aviso: não consegui registrar os não-casados:', error.message);
    }
    console.log(`não casados registrados em import_nao_casado: ${naoCasou.length}`);
  }

  console.log('\nconcluído.');
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
