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

// No modelo ETHB o foco de venda é o Aurum. A flag "possível comprador"
// (dados_extra.possivel_comprador) JÁ significa "possível comprador do Aurum" —
// não mostramos mais os sinais separados de Aurum/renov./HM/renov.HM (decisão do
// Marcio 2026-08-03). Mantida a função retornando vazio para não quebrar quem a
// importa; a informação relevante fica no selo "Possível comprador".
export function sinaisCracha() {
  return [];
}
