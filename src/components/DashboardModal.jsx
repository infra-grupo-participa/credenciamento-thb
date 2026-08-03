import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { tipoLabel } from '../tipos.js';
import { NIVEIS, nivelInstrucao, ehPossivelComprador } from '../perfil.js';
import { linhasExport, aplicarQrImagem } from '../exportRows.js';
import { useToast } from './Toasts.jsx';
import { IconClose } from '../icons.jsx';

const TIPOS = ['comum', 'socio', 'diamante', 'convidado'];

function baixarCSV(nome, cabecalho, linhas) {
  const esc = (c) => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`;
  const csv = [cabecalho, ...linhas].map((r) => r.map(esc).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nome; a.click(); URL.revokeObjectURL(a.href);
}

function Barra({ label, valor, max, sub }) {
  const pct = max ? Math.round((valor / max) * 100) : 0;
  return (
    <div className="bar-row">
      <div className="bar-label">{label}</div>
      <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
      <div className="bar-val">{valor}{sub ? `/${sub}` : ''}</div>
    </div>
  );
}

export default function DashboardModal({ eventoId, eventoNome, lista, onClose }) {
  const toast = useToast();
  const [aba, setAba] = useState('resumo');
  const [audit, setAudit] = useState(null);

  useEffect(() => {
    if (aba === 'auditoria' && audit === null) {
      api.auditoria(eventoId).then((r) => setAudit(r.itens || [])).catch(() => setAudit([]));
    }
  }, [aba, audit, eventoId]);

  const stats = useMemo(() => {
    const total = lista.length;
    const cred = lista.filter((p) => p.credenciado).length;
    const porTipo = TIPOS.map((t) => {
      const arr = lista.filter((p) => p.tipo === t);
      return { t, total: arr.length, cred: arr.filter((p) => p.credenciado).length };
    }).filter((x) => x.total > 0);
    const turmaMap = {};
    lista.forEach((p) => { const k = p.turma || '—'; (turmaMap[k] = turmaMap[k] || { total: 0, cred: 0 }); turmaMap[k].total++; if (p.credenciado) turmaMap[k].cred++; });
    const porTurma = Object.entries(turmaMap).map(([k, v]) => ({ k, ...v })).sort((a, b) => b.total - a.total).slice(0, 10);
    const horaMap = {};
    lista.filter((p) => p.credenciado && p.dataCredenciamento).forEach((p) => {
      const d = new Date(p.dataCredenciamento);
      if (!isNaN(d)) { const k = `${String(d.getHours()).padStart(2, '0')}h`; horaMap[k] = (horaMap[k] || 0) + 1; }
    });
    const porHora = Object.entries(horaMap).map(([k, v]) => ({ k, v })).sort((a, b) => a.k.localeCompare(b.k));
    return { total, cred, pend: total - cred, pct: total ? Math.round((cred / total) * 100) : 0, porTipo, porTurma, porHora };
  }, [lista]);

  // Perfil & presença: por NÍVEL DE INSTRUÇÃO THB (eixo que o Arthur pediu),
  // cruzando presença (credenciado) com "possível comprador" (marcado pela equipe).
  const perfil = useMemo(() => {
    const base = {};
    NIVEIS.forEach((n) => { base[n.key] = { ...n, total: 0, presentes: 0, ausentes: 0, compProx: 0, compPres: 0, compAus: 0 }; });
    lista.forEach((p) => {
      const n = nivelInstrucao(p);
      const b = base[n.key] || base.thb;
      const comp = ehPossivelComprador(p);
      b.total++;
      if (p.credenciado) { b.presentes++; if (comp) b.compPres++; }
      else { b.ausentes++; if (comp) b.compAus++; }
      if (comp) b.compProx++;
    });
    const linhas = NIVEIS.map((n) => base[n.key]).filter((b) => b.total > 0).sort((a, b) => b.rank - a.rank);
    const tot = lista.length;
    const presentes = lista.filter((p) => p.credenciado).length;
    const compradores = lista.filter(ehPossivelComprador);
    return {
      linhas,
      totais: {
        total: tot, presentes, ausentes: tot - presentes,
        comprador: compradores.length,
        compPresentes: compradores.filter((p) => p.credenciado).length,
        compAusentes: compradores.filter((p) => !p.credenciado).length,
      },
    };
  }, [lista]);

  // Exporta um recorte da lista atual (presença × possível comprador) — para a equipe/Active.
  function exportarRecorte(nome, filtro) {
    const arr = lista.filter(filtro);
    if (!arr.length) { toast('Nenhum participante nesse recorte', ''); return; }
    const rows = linhasExport(arr, window.location.origin).map(({ 'QR (imagem)': _img, ...rest }) => rest);
    const cab = rows.length ? Object.keys(rows[0]) : [];
    baixarCSV(`${eventoId}-${nome}.csv`, cab, rows.map((r) => cab.map((k) => r[k])));
    toast('CSV gerado', 'success');
  }

  async function exportarCSV(filtro) {
    try {
      const d = await api.exportar(eventoId);
      let lista = d.list || [];
      if (filtro === 'cred') lista = lista.filter((p) => p.credenciado);
      if (filtro === 'pend') lista = lista.filter((p) => !p.credenciado);
      // Mesmo formato do Excel, sem a coluna de imagem do QR (CSV não renderiza).
      const rows = linhasExport(lista, window.location.origin).map(({ 'QR (imagem)': _img, ...rest }) => rest);
      const cab = rows.length ? Object.keys(rows[0]) : [];
      const linhas = rows.map((r) => cab.map((k) => r[k]));
      const sufixo = filtro === 'cred' ? 'credenciados' : filtro === 'pend' ? 'no-show' : 'todos';
      baixarCSV(`${eventoId}-${sufixo}.csv`, cab, linhas);
      toast('CSV gerado', 'success');
    } catch { toast('Erro ao gerar CSV', 'danger'); }
  }

  async function exportarXLSX() {
    try {
      const d = await api.exportar(eventoId);
      const XLSX = await import('xlsx');
      const rows = linhasExport(d.list, window.location.origin);
      const ws = XLSX.utils.json_to_sheet(rows);
      aplicarQrImagem(XLSX, ws);
      const wbk = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wbk, ws, 'Credenciamento');
      XLSX.writeFile(wbk, `${eventoId}-credenciamento.xlsx`);
      toast('Excel gerado', 'success');
    } catch { toast('Erro ao gerar Excel', 'danger'); }
  }

  const maxTurma = Math.max(1, ...stats.porTurma.map((t) => t.total));
  const maxHora = Math.max(1, ...stats.porHora.map((h) => h.v));

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>Painel · {eventoNome}</h3>
          <button className="icon-btn" onClick={onClose} title="Fechar"><IconClose /></button>
        </div>
        <div className="modal-body">
          <div className="tabs">
            <button className={aba === 'resumo' ? 'active' : ''} onClick={() => setAba('resumo')}>Resumo</button>
            <button className={aba === 'perfil' ? 'active' : ''} onClick={() => setAba('perfil')}>Perfil &amp; Presença</button>
            <button className={aba === 'auditoria' ? 'active' : ''} onClick={() => setAba('auditoria')}>Auditoria</button>
          </div>

          {aba === 'resumo' && (
            <>
              <div className="dash-cards">
                <div className="dash-card"><span>Total</span><b>{stats.total}</b></div>
                <div className="dash-card ok"><span>Credenciados</span><b>{stats.cred}</b></div>
                <div className="dash-card warn"><span>Pendentes</span><b>{stats.pend}</b></div>
                <div className="dash-card acc"><span>Progresso</span><b>{stats.pct}%</b></div>
              </div>

              <div className="detail-section">Por tipo</div>
              {stats.porTipo.map((x) => <Barra key={x.t} label={tipoLabel(x.t)} valor={x.cred} sub={x.total} max={x.total} />)}

              <div className="detail-section">Por turma (top 10)</div>
              {stats.porTurma.map((x) => <Barra key={x.k} label={x.k} valor={x.cred} sub={x.total} max={maxTurma} />)}

              <div className="detail-section">Chegada por hora (credenciamentos)</div>
              {stats.porHora.length === 0 && <div className="photo-empty">Ainda sem credenciamentos.</div>}
              {stats.porHora.map((x) => <Barra key={x.k} label={x.k} valor={x.v} max={maxHora} />)}

              <div className="detail-section">Exportar CSV</div>
              <div className="dash-exports">
                <button className="btn" onClick={() => exportarCSV('cred')}>Credenciados</button>
                <button className="btn" onClick={() => exportarCSV('pend')}>No-show (pendentes)</button>
                <button className="btn" onClick={() => exportarCSV('todos')}>Todos</button>
              </div>

              <div className="detail-section">Excel para envio de e-mail (com link individual de cada aluno)</div>
              <div className="dash-exports">
                <button className="btn primary" onClick={exportarXLSX}>Baixar Excel (.xlsx)</button>
              </div>
            </>
          )}

          {aba === 'perfil' && (
            <>
              <div className="dash-cards">
                <div className="dash-card ok"><span>Presentes</span><b>{perfil.totais.presentes}</b></div>
                <div className="dash-card warn"><span>Ausentes</span><b>{perfil.totais.ausentes}</b></div>
                <div className="dash-card acc"><span>Possíveis compradores</span><b>{perfil.totais.comprador}</b></div>
              </div>

              <div className="detail-section">Por nível de instrução (Time Holding Brasil)</div>
              <div className="perfil-tab-wrap">
                <table className="perfil-tbl">
                  <thead>
                    <tr>
                      <th>Nível</th><th>Total</th><th>Presentes</th><th>Ausentes</th>
                      <th title="Possíveis compradores presentes">P. compr. presentes</th>
                      <th title="Possíveis compradores ausentes">P. compr. ausentes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perfil.linhas.map((b) => (
                      <tr key={b.key}>
                        <td><span className={`perfil-nivel nivel-${b.cls}`}>{b.label}</span></td>
                        <td>{b.total}</td>
                        <td className="ok-num">{b.presentes}</td>
                        <td className="warn-num">{b.ausentes}</td>
                        <td>{b.compPres || '—'}</td>
                        <td>{b.compAus || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="detail-section">Recortes que o Arthur pediu</div>
              <div className="perfil-recortes">
                <div className="perfil-recorte">
                  <div className="pr-num">{perfil.totais.compPresentes}</div>
                  <div className="pr-lbl">Presentes que são possíveis compradores</div>
                  <button className="btn mini" onClick={() => exportarRecorte('presentes-possiveis-compradores', (p) => p.credenciado && ehPossivelComprador(p))}>Exportar CSV</button>
                </div>
                <div className="perfil-recorte">
                  <div className="pr-num">{perfil.totais.compAusentes}</div>
                  <div className="pr-lbl">Ausentes que são possíveis compradores</div>
                  <button className="btn mini" onClick={() => exportarRecorte('ausentes-possiveis-compradores', (p) => !p.credenciado && ehPossivelComprador(p))}>Exportar CSV</button>
                </div>
              </div>

              <div className="perfil-nota">
                “Possível comprador” é marcado pela equipe no card do aluno (no check-in ou na ficha) e vale para a pessoa nos 3 dias.
              </div>
            </>
          )}

          {aba === 'auditoria' && (
            <div className="kvs">
              {audit === null && <div className="center-screen" style={{ minHeight: 120 }}><div className="spinner" /></div>}
              {audit && audit.length === 0 && <div className="photo-empty">Sem registros de auditoria neste evento.</div>}
              {audit && audit.map((a) => (
                <div key={a.id} className="audit-row">
                  <span className={`audit-acao acao-${a.acao}`}>{a.acao}</span>
                  <span className="audit-nome">{a.nome || a.detalhe || '—'}</span>
                  <span className="audit-op">{a.operador || '—'}</span>
                  <span className="audit-quando">{a.criado_em ? new Date(a.criado_em).toLocaleString('pt-BR') : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn primary" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
