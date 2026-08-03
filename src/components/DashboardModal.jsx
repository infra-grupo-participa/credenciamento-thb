import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { NIVEIS, nivelInstrucao, ehPossivelComprador, ingressoLabel } from '../perfil.js';
import { linhasExport, aplicarQrImagem } from '../exportRows.js';
import { useToast } from './Toasts.jsx';
import { IconClose } from '../icons.jsx';

// Ordem de valor dos ingressos do evento (topo → base).
const INGRESSOS = ['DIAMOND', 'VIP', 'PLATEIA'];
// "Produtos" que o time avaliou no crachá (colunas Possível X). Cada aluno pode
// contar em vários — é o interesse potencial, não uma escolha única.
const PRODUTOS = [
  { k: 'possivel_aurum', label: 'Aurum' },
  { k: 'possivel_renov_aurum', label: 'Renovação Aurum' },
  { k: 'possivel_hm', label: 'Holding Masters (HM)' },
  { k: 'possivel_renov_hm', label: 'Renovação HM' },
];
const ehSim = (v) => String(v == null ? '' : v).trim().toUpperCase() === 'SIM';

function baixarCSV(nome, cabecalho, linhas) {
  const esc = (c) => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`;
  const csv = [cabecalho, ...linhas].map((r) => r.map(esc).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nome; a.click(); URL.revokeObjectURL(a.href);
}

// Barra horizontal proporcional (credenciados sobre o total do grupo).
function Barra({ label, valor, sub, max, tone }) {
  const pct = max ? Math.round((valor / max) * 100) : 0;
  return (
    <div className="bar-row">
      <div className="bar-label">{label}</div>
      <div className="bar-track"><div className={`bar-fill ${tone || ''}`} style={{ width: `${pct}%` }} /></div>
      <div className="bar-val">{valor}{sub != null ? `/${sub}` : ''}</div>
    </div>
  );
}

export default function DashboardModal({ eventoId, eventoNome, lista, onClose }) {
  const toast = useToast();
  const [aba, setAba] = useState('dashboard');
  const [audit, setAudit] = useState(null);

  useEffect(() => {
    if (aba === 'auditoria' && audit === null) {
      api.auditoria(eventoId).then((r) => setAudit(r.itens || [])).catch(() => setAudit([]));
    }
  }, [aba, audit, eventoId]);

  const m = useMemo(() => {
    const total = lista.length;
    const cred = lista.filter((p) => p.credenciado).length;
    const compradores = lista.filter(ehPossivelComprador);
    const compCred = compradores.filter((p) => p.credenciado).length;

    // Participantes por ingresso (DIAMOND/VIP/PLATEIA) — total e credenciados.
    const porIngresso = INGRESSOS.map((ing) => {
      const arr = lista.filter((p) => ingressoLabel(p) === ing);
      return { ing, total: arr.length, cred: arr.filter((p) => p.credenciado).length };
    }).filter((x) => x.total > 0);
    const semIngresso = lista.filter((p) => !ingressoLabel(p));
    if (semIngresso.length) porIngresso.push({ ing: 'Diamante / outros', total: semIngresso.length, cred: semIngresso.filter((p) => p.credenciado).length });

    // Possíveis compradores por produto (Aurum/HM/renovações) — presença dentro de cada.
    const porProduto = PRODUTOS.map((prod) => {
      const arr = compradores.filter((p) => ehSim(p.dados_extra && p.dados_extra[prod.k]));
      return { label: prod.label, total: arr.length, cred: arr.filter((p) => p.credenciado).length };
    }).filter((x) => x.total > 0);

    // Possíveis compradores por nível de instrução THB (extra útil — quente/morno).
    const porNivel = NIVEIS.map((n) => {
      const arr = compradores.filter((p) => nivelInstrucao(p).key === n.key);
      return { ...n, total: arr.length, cred: arr.filter((p) => p.credenciado).length };
    }).filter((x) => x.total > 0).sort((a, b) => b.rank - a.rank);

    return {
      total, cred, pend: total - cred, pct: total ? Math.round((cred / total) * 100) : 0,
      comprador: compradores.length, compCred, compFalt: compradores.length - compCred,
      porIngresso, porProduto, porNivel,
    };
  }, [lista]);

  const maxIng = Math.max(1, ...m.porIngresso.map((x) => x.total));
  const maxProd = Math.max(1, ...m.porProduto.map((x) => x.total));

  // Exporta um recorte da lista (CSV no mesmo formato do Excel, sem a imagem do QR).
  function exportarRecorte(nome, filtro) {
    const arr = (typeof filtro === 'function') ? lista.filter(filtro) : lista;
    if (!arr.length) { toast('Nenhum participante nesse recorte', ''); return; }
    const rows = linhasExport(arr, window.location.origin).map(({ 'QR (imagem)': _img, ...rest }) => rest);
    const cab = rows.length ? Object.keys(rows[0]) : [];
    baixarCSV(`${eventoId}-${nome}.csv`, cab, rows.map((r) => cab.map((k) => r[k])));
    toast('CSV gerado', 'success');
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

  // Página (quando embutido no app, sem onClose) ou modal (compatibilidade, com onClose).
  const comoPagina = !onClose;

  const conteudo = (
    <>
      {!comoPagina && (
        <div className="modal-head">
          <h3>Dashboard · {eventoNome}</h3>
          <button className="icon-btn" onClick={onClose} title="Fechar"><IconClose /></button>
        </div>
      )}
        <div className={comoPagina ? 'dash-page-body' : 'modal-body'}>
          <div className="tabs">
            <button className={aba === 'dashboard' ? 'active' : ''} onClick={() => setAba('dashboard')}>Dashboard</button>
            <button className={aba === 'exportar' ? 'active' : ''} onClick={() => setAba('exportar')}>Exportar</button>
            <button className={aba === 'auditoria' ? 'active' : ''} onClick={() => setAba('auditoria')}>Auditoria</button>
          </div>

          {aba === 'dashboard' && (
            <>
              {/* Panorama */}
              <div className="dash-cards">
                <div className="dash-card"><span>Total</span><b>{m.total}</b></div>
                <div className="dash-card ok"><span>Credenciados</span><b>{m.cred}</b></div>
                <div className="dash-card warn"><span>Pendentes</span><b>{m.pend}</b></div>
                <div className="dash-card acc"><span>Progresso</span><b>{m.pct}%</b></div>
              </div>

              {/* Foco do time: possíveis compradores */}
              <div className="detail-section">Possíveis compradores</div>
              <div className="dash-cards dash-cards-3">
                <div className="dash-card acc"><span>Total possíveis compradores</span><b>{m.comprador}</b></div>
                <div className="dash-card ok"><span>Já credenciados (chegaram)</span><b>{m.compCred}</b></div>
                <div className="dash-card danger"><span>Faltantes (ainda não chegaram)</span><b>{m.compFalt}</b></div>
              </div>
              {m.comprador > 0 && (
                <div className="dash-actions-inline">
                  <button className="btn mini" onClick={() => exportarRecorte('possiveis-compradores-faltantes', (p) => ehPossivelComprador(p) && !p.credenciado)}>
                    Exportar faltantes (CSV)
                  </button>
                  <button className="btn mini ghost" onClick={() => exportarRecorte('possiveis-compradores-todos', (p) => ehPossivelComprador(p))}>
                    Exportar todos os possíveis compradores
                  </button>
                </div>
              )}

              {/* Participantes por ingresso */}
              <div className="detail-section">Participantes por ingresso</div>
              {m.porIngresso.map((x) => (
                <Barra key={x.ing} label={x.ing} valor={x.cred} sub={x.total} max={maxIng} tone="ok" />
              ))}
              <div className="dash-legenda">barra = credenciados · número = credenciados / total</div>

              {/* Possíveis compradores por produto */}
              <div className="detail-section">Possíveis compradores por produto</div>
              {m.porProduto.length === 0 && <div className="photo-empty">Sem sinais de produto marcados.</div>}
              {m.porProduto.map((x) => (
                <Barra key={x.label} label={x.label} valor={x.cred} sub={x.total} max={maxProd} tone="acc" />
              ))}
              {m.porProduto.length > 0 && (
                <div className="dash-legenda">barra = quantos já chegaram · número = credenciados / total de possíveis</div>
              )}

              {/* Extra: possíveis compradores por nível THB (quente → base) */}
              <div className="detail-section">Possíveis compradores por nível (THB)</div>
              <div className="perfil-tab-wrap">
                <table className="perfil-tbl">
                  <thead>
                    <tr><th>Nível</th><th>Poss. compradores</th><th>Credenciados</th><th>Faltantes</th></tr>
                  </thead>
                  <tbody>
                    {m.porNivel.map((x) => (
                      <tr key={x.key}>
                        <td><span className={`perfil-nivel nivel-${x.cls}`}>{x.label}</span></td>
                        <td>{x.total}</td>
                        <td className="ok-num">{x.cred}</td>
                        <td className="warn-num">{x.total - x.cred || '—'}</td>
                      </tr>
                    ))}
                    {m.porNivel.length === 0 && <tr><td colSpan={4} className="photo-empty">Nenhum possível comprador ainda.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {aba === 'exportar' && (
            <>
              <div className="detail-section">Listas de credenciamento (CSV)</div>
              <div className="dash-exports">
                <button className="btn" onClick={() => exportarRecorte('todos', null)}>Todos</button>
                <button className="btn" onClick={() => exportarRecorte('credenciados', (p) => p.credenciado)}>Credenciados</button>
                <button className="btn" onClick={() => exportarRecorte('no-show', (p) => !p.credenciado)}>No-show (pendentes)</button>
              </div>

              <div className="detail-section">Possíveis compradores (CSV)</div>
              <div className="dash-exports">
                <button className="btn" onClick={() => exportarRecorte('possiveis-compradores-todos', (p) => ehPossivelComprador(p))}>Todos</button>
                <button className="btn" onClick={() => exportarRecorte('possiveis-compradores-credenciados', (p) => ehPossivelComprador(p) && p.credenciado)}>Credenciados</button>
                <button className="btn" onClick={() => exportarRecorte('possiveis-compradores-faltantes', (p) => ehPossivelComprador(p) && !p.credenciado)}>Faltantes</button>
              </div>

              <div className="detail-section">Excel para envio de e-mail (QR de cada aluno)</div>
              <div className="dash-exports">
                <button className="btn primary" onClick={exportarXLSX}>Baixar Excel (.xlsx)</button>
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
      {!comoPagina && (
        <div className="modal-foot">
          <button type="button" className="btn primary" onClick={onClose}>Fechar</button>
        </div>
      )}
    </>
  );

  // Página: renderiza direto no fluxo do app (uma "aba" separada).
  if (comoPagina) return <div className="dash-page">{conteudo}</div>;
  // Modal: overlay clicável para fechar (mantido por compatibilidade).
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg" role="dialog" aria-modal="true">{conteudo}</div>
    </div>
  );
}
