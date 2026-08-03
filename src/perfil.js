// Perfil do participante para a equipe: nível de instrução dentro do THB e
// sinal de "possível comprador". Deriva de campos já existentes (não altera o
// banco): a Instrução da planilha (THB/AURUM/PLATINA/DIAMANTE/...), o tipo
// (comum/socio/diamante) e o grupoDiamante (Diamante Titular/Vermelho/Sócio).

// Régua do MENOR para o MAIOR nível dentro do THB. rank orienta ordenação/cor.
export const NIVEIS = [
  { key: 'exaluno',  label: 'Ex-aluno / não localizado', rank: 0, cls: 'exaluno' },
  { key: 'thb',      label: 'THB',                        rank: 1, cls: 'thb' },
  { key: 'aurum',    label: 'Aurum',                      rank: 2, cls: 'aurum' },
  { key: 'platina',  label: 'Platina',                    rank: 3, cls: 'platina' },
  { key: 'diamante', label: 'Diamante',                   rank: 4, cls: 'diamante' },
  { key: 'diamante_vermelho', label: 'Diamante Vermelho', rank: 5, cls: 'diamante-vermelho' },
];
const POR_KEY = Object.fromEntries(NIVEIS.map((n) => [n.key, n]));

const up = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Classifica o nível de instrução THB. Retorna { key, label, cls, socio }.
// - Diamantes (tipo=diamante): grupoDiamante distingue Titular/Vermelho/Sócio.
// - Demais: lê a coluna Instrução da planilha ("AURUM - SÓCIO", "THB", "PLATINA"...).
export function nivelInstrucao(p) {
  const ex = p && p.dados_extra && typeof p.dados_extra === 'object' ? p.dados_extra : {};
  const instr = up(ex['Instrução'] || ex['Instrucao'] || p.instrucao);
  const gd = up(p.grupoDiamante);
  // Nível deriva de grupoDiamante + instrução (não do tipo — que agora é
  // comprador/convidado, sobre quem PAGOU, não sobre o nível dentro do THB).
  const socio = /SOCIO/.test(instr) || /SOCIO/.test(gd);

  let key = null;
  if (/DIAMANTE/.test(gd) || /DIAMANTE/.test(instr)) {
    key = (/VERMELHO/.test(gd) || /VERMELHO/.test(instr)) ? 'diamante_vermelho' : 'diamante';
  } else if (/PLATINA/.test(instr)) key = 'platina';
  else if (/AURUM/.test(instr)) key = 'aurum';
  else if (/THB/.test(instr)) key = 'thb';
  else if (/EX ALUNO|NAO LOCALIZAD/.test(instr)) key = 'exaluno';
  else key = 'thb'; // sem instrução declarada → tratado como base THB

  const n = POR_KEY[key] || POR_KEY.thb;
  return { ...n, socio };
}

// Rótulo curto com o sufixo de sócio, para badges ("Aurum · Sócio").
export function nivelLabel(p) {
  const n = nivelInstrucao(p);
  return n.socio ? `${n.label} · Sócio` : n.label;
}

// Ingresso comprado no evento (DIAMOND/VIP/PLATEIA) — separado do nível THB.
export function ingressoLabel(p) {
  const gd = String(p && p.grupoDiamante || '').trim();
  if (/^(DIAMOND|VIP|PLATEIA)$/i.test(gd)) return gd.toUpperCase();
  return '';
}

// "Possível comprador?" — sinal alimentado pela equipe (dados_extra.possivel_comprador).
export function ehPossivelComprador(p) {
  const ex = p && p.dados_extra && typeof p.dados_extra === 'object' ? p.dados_extra : null;
  return !!(ex && ex.possivel_comprador);
}

// Faturamento declarado (coluna própria ou dentro de dados_extra), se houver.
export function faturamentoDe(p) {
  if (p && p.faturamento) return String(p.faturamento);
  const ex = p && p.dados_extra && typeof p.dados_extra === 'object' ? p.dados_extra : {};
  return String(ex['Faturamento'] || ex['faturamento'] || '').trim();
}

// Sinais de perfil do crachá (o que o time preencheu na planilha): "possível
// Aurum/HM/renovação", "sócio vai sozinho". Vêm de dados_extra (importados da aba
// Crachá). Devolve só os que têm valor, já normalizados para exibição (SIM/NÃO/-).
const SINAIS_CRACHA = [
  { k: 'possivel_aurum', label: 'Possível Aurum' },
  { k: 'possivel_renov_aurum', label: 'Possível renov. Aurum' },
  { k: 'possivel_hm', label: 'Possível HM' },
  { k: 'possivel_renov_hm', label: 'Possível renov. HM' },
  { k: 'socio_vai_sozinho', label: 'Sócio vai sozinho' },
];
// "SIM"/"true" → sim; "NÃO"/"false" → nao; senão o texto cru (ex.: "-").
function classifica(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return null;
  if (s === 'sim' || s === 'true') return { valor: 'SIM', sim: true };
  if (s === 'não' || s === 'nao' || s === 'false') return { valor: 'NÃO', sim: false };
  return { valor: String(v).trim(), sim: null };
}
export function sinaisCracha(p) {
  const ex = p && p.dados_extra && typeof p.dados_extra === 'object' ? p.dados_extra : {};
  const out = [];
  for (const s of SINAIS_CRACHA) {
    const c = classifica(ex[s.k]);
    if (c && c.valor !== '-') out.push({ label: s.label, valor: c.valor, sim: c.sim });
  }
  return out;
}
