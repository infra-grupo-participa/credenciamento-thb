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

// Níveis da régua THB. Só estes têm rótulo próprio; qualquer outra origem
// (Ex aluno, Ex Aurum, Ex-HT, Ex sócia, Tráfego, Não encontrado, Familiar de…)
// é mostrada com o TEXTO EXATO da planilha.
const NIVEL_CANONICO = /^(THB|AURUM|PLATINA|DIAMANTE)/;

// Classifica o nível de instrução THB. Retorna { key, label, cls, socio }.
// - Diamantes (tipo=diamante): grupoDiamante distingue Titular/Vermelho/Sócio.
// - Demais: lê a coluna Instrução da planilha ("AURUM - SÓCIO", "THB", "PLATINA"...).
export function nivelInstrucao(p) {
  const ex = p && p.dados_extra && typeof p.dados_extra === 'object' ? p.dados_extra : {};
  // A COLUNA `instrucao` manda. É ela que a equipe edita pela tela e que o import
  // atualiza; o `dados_extra` guarda a linha da planilha como veio na carga e pode
  // estar defasado (era o caso de 57 pessoas do ETHB SP em 04/08/2026).
  const bruto = String((p && p.instrucao) || ex['Instrução'] || ex['Instrucao'] || '').trim();
  const instr = up(bruto);
  const gd = up(p.grupoDiamante);
  // Nível deriva de grupoDiamante + instrução (não do tipo — que agora é
  // comprador/convidado, sobre quem PAGOU, não sobre o nível dentro do THB).
  const socio = /SOCIO/.test(instr) || /SOCIO/.test(gd);

  if (/DIAMANTE/.test(gd) || /DIAMANTE/.test(instr)) {
    const k = (/VERMELHO/.test(gd) || /VERMELHO/.test(instr)) ? 'diamante_vermelho' : 'diamante';
    return { ...POR_KEY[k], socio };
  }
  // Vem ANTES de Platina/Aurum/THB de propósito: "Ex Aurum" não é Aurum e
  // "Ex-HT" não é THB — cair no `else` genérico rotulava essa gente como THB.
  // A chave segue 'exaluno' (o Dashboard agrupa por key), só o rótulo é o texto real.
  if (instr && !NIVEL_CANONICO.test(instr)) {
    return { ...POR_KEY.exaluno, label: bruto, socio: false };
  }

  let key = null;
  if (/PLATINA/.test(instr)) key = 'platina';
  else if (/AURUM/.test(instr)) key = 'aurum';
  else if (/THB/.test(instr)) key = 'thb';
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
