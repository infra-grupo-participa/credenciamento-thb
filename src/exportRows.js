// Monta as linhas de exportação num formato único, enxuto e sem duplicidade.
// Usado pelo export principal (App) e pelo Dashboard, para ficarem idênticos.

const TIPO_LABEL = { comum: 'Comum', socio: 'Sócio', diamante: 'Diamante', convidado: 'Convidado' };

export function linhasExport(list, origin) {
  const limpa = (v) => { const s = v == null ? '' : String(v).trim(); return s === '-' ? '' : s; };
  const pega = (ex, ...keys) => { for (const k of keys) { const v = limpa(ex && ex[k]); if (v) return v; } return ''; };
  const simNao = (v) => { const s = limpa(v).toLowerCase(); if (!s) return ''; if (s[0] === 's') return 'Sim'; if (s[0] === 'n') return 'Não'; return limpa(v); };
  const tipo = (t) => TIPO_LABEL[t] || t || '';
  const tok = (p) => p.pessoa_token || p.id;
  return (list || []).map((p) => {
    const ex = p.dados_extra && typeof p.dados_extra === 'object' ? p.dados_extra : {};
    const endereco = pega(ex, 'THB - Endereço') || [pega(ex, 'Endereço'), pega(ex, 'Número')].filter(Boolean).join(', ');
    // Representante (opt-in): o e-mail/telefone de DISPARO passa a ser o dele.
    const rep = p.representante && typeof p.representante === 'object' && (p.representante.nome || p.representante.email) ? p.representante : null;
    const emailEnvio = (rep && limpa(rep.email)) || p.email;
    const telEnvio = (rep && limpa(rep.telefone)) || p.telefone;
    return {
      'QR (imagem)': `${origin}/qrimg/${tok(p)}`,
      'QR (link)': `${origin}/qr/${tok(p)}`,
      'Lote': pega(ex, 'lote'),
      'Nome': p.nome,
      'Tipo': tipo(p.tipo),
      'Ingresso': pega(ex, 'Ingresso final', 'Ingresso'),
      'Grupo (Diamante)': pega(ex, 'Categoria') || (p.grupoDiamante || ''),
      'Representante': rep ? (rep.nome || '') : '',
      'E-mail': emailEnvio,
      'E-mail comprador': rep ? p.email : '',
      'Telefone': telEnvio,
      'Documento': p.documento,
      'Cidade': p.cidade,
      'Estado': p.estado,
      'Endereço': endereco,
      'Bairro': pega(ex, 'THB - Bairro', 'Bairro'),
      'CEP': pega(ex, 'THB - CEP', 'CEP'),
      'Turma': p.turma,
      'Camisa': p.tamanhoCamisa,
      'Nome no crachá': p.nomeCracha,
      'No grupo': simNao(p.grupo),
      'Possível comprador?': pega(ex, 'Possível comprador?'),
      'Convidado por': p.convidadoPor,
      'Profissão': p.profissao,
      'Nível': p.nivel,
      'Plano (THB)': pega(ex, 'THB - Plano'),
      'É sócio (THB)': pega(ex, 'THB - É sócio'),
      'Credenciado': p.credenciado ? 'SIM' : 'NÃO',
      'Data credenciamento': p.dataCredenciamento,
      // --- Qualificação comercial (vem do import da pesquisa/crachá) ---
      // Ficam no FIM de propósito: quem exporta para conferir credenciamento
      // continua vendo as colunas de sempre nas primeiras posições, e quem vai
      // analisar lead rola para a direita. Sai tudo já cruzado, para o analista
      // não ter de juntar planilha com planilha na mão.
      'Lead score': typeof p.lead_score === 'number' ? p.lead_score : '',
      'Temperatura': temperatura(p.lead_score),
      'Respondeu pesquisa': p.pesquisa_ok ? 'SIM' : 'NÃO',
      'Possível comprador (pesquisa)': sinalSN(p.sinal, 'possivel_comprador'),
      'Possível Aurum': sinalSN(p.sinal, 'possivel_aurum'),
      'Possível renovação Aurum': sinalSN(p.sinal, 'possivel_renov_aurum'),
      'Possível HM': sinalSN(p.sinal, 'possivel_hm'),
      'Possível renovação HM': sinalSN(p.sinal, 'possivel_renov_hm'),
      'Origem/Instrução': (p.sinal && limpa(p.sinal.origem)) || '',
      'Ingresso (planilha)': (p.sinal && limpa(p.sinal.ingresso)) || '',
      'Sócio vai sozinho': (p.sinal && limpa(p.sinal.socio_vai_sozinho)) || '',
    };
  });
}

// Faixa de temperatura do lead. Mesmos cortes da tela, para a planilha e o app
// nunca discordarem sobre quem está "quente".
function temperatura(score) {
  if (typeof score !== 'number' || score <= 0) return '';
  if (score < 30) return 'FRIO';
  if (score < 60) return 'MORNO';
  if (score < 80) return 'QUENTE';
  return 'MUITO QUENTE';
}

// Sinal comercial em SIM/NÃO. Diferencia "não" de "sem informação": o campo vem
// null quando a planilha de origem trazia "-", e transformar isso em "NÃO"
// afirmaria algo que ninguém verificou.
function sinalSN(sinal, campo) {
  if (!sinal || typeof sinal !== 'object') return '';
  const v = sinal[campo];
  if (v === true) return 'SIM';
  if (v === false) return 'NÃO';
  return '';
}

// Larguras das primeiras colunas (QR imagem/link, Lote, Nome, Tipo, E-mail, Telefone, Documento).
export const LARGURAS_EXPORT = [{ wch: 14 }, { wch: 40 }, { wch: 6 }, { wch: 26 }, { wch: 10 }, { wch: 28 }, { wch: 15 }, { wch: 16 }];

// Aplica a fórmula =IMAGE() na 1ª coluna (QR imagem) para renderizar o QR na célula.
export function aplicarQrImagem(XLSX, ws) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let r = 1; r <= range.e.r; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 0 });
    const cell = ws[addr];
    if (cell && cell.v) ws[addr] = { t: 's', f: `IMAGE("${cell.v}")` };
  }
  ws['!cols'] = LARGURAS_EXPORT;
}
