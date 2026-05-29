import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, auth } from './api.js';
import { useToast } from './components/Toasts.jsx';
import Login from './components/Login.jsx';
import ParticipantModal from './components/ParticipantModal.jsx';
import DetailModal from './components/DetailModal.jsx';
import EventBar from './components/EventBar.jsx';
import HistoryModal from './components/HistoryModal.jsx';
import ScannerModal from './components/ScannerModal.jsx';
import DashboardModal from './components/DashboardModal.jsx';
import { beepOk, beepErr } from './beep.js';
import { enfileirar, flushFila, tamanhoFila } from './offline.js';
import { tipoLabel, tipoCls } from './tipos.js';
import {
  IconImport, IconExport, IconPlus, IconSearch, IconCheck, IconSquare, IconEdit, IconLogout,
} from './icons.jsx';

const POLL_MS = 5000;

const norm = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const initials = (n) => {
  if (!n) return '?';
  const p = n.trim().split(/\s+/);
  return ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
};
const horaAgora = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export default function App() {
  const [operador, setOperador] = useState(auth.token ? auth.operador : null);
  const [checando, setChecando] = useState(!!auth.token);

  useEffect(() => {
    if (auth.token) {
      api.me().then((d) => setOperador(d.operador)).catch(() => setOperador(null)).finally(() => setChecando(false));
    }
    const onUnauth = () => { setOperador(null); setChecando(false); };
    window.addEventListener('chf:unauthorized', onUnauth);
    return () => window.removeEventListener('chf:unauthorized', onUnauth);
  }, []);

  if (checando) return <div className="center-screen"><div className="spinner" /></div>;
  if (!operador) return <Login onLogin={(nome) => { setOperador(nome); setChecando(false); }} />;
  return <Credenciamento operador={operador} onLogout={() => { auth.clear(); setOperador(null); }} />;
}

function Credenciamento({ operador, onLogout }) {
  const qc = useQueryClient();
  const toast = useToast();

  const [eventoId, setEventoId] = useState(null);
  const [filtro, setFiltro] = useState('todos');
  const [tipoFiltro, setTipoFiltro] = useState('todos');
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState('nome');
  const [editando, setEditando] = useState(undefined);
  const [novoNome, setNovoNome] = useState('');
  const [detalheId, setDetalheId] = useState(null);
  const [histOpen, setHistOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [dashOpen, setDashOpen] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [pendentes, setPendentes] = useState(tamanhoFila());
  const fileRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    function onKey(e) {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'select' || tag === 'textarea';
      if (!typing && (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'))) {
        e.preventDefault(); searchRef.current?.focus();
      }
      if (e.key === 'Escape') setScanOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Sincroniza a fila offline quando a conexão volta (e ao abrir).
  useEffect(() => {
    async function sincronizar() {
      const n = await flushFila((id, cred) => api.credenciar(id, cred));
      setPendentes(tamanhoFila());
      if (n > 0) {
        toast(`${n} credenciamento(s) sincronizado(s)`, 'success');
        qc.invalidateQueries({ queryKey: ['participantes'] });
        qc.invalidateQueries({ queryKey: ['eventos'] });
      }
    }
    const up = () => { setOnline(true); sincronizar(); };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    if (navigator.onLine) sincronizar();
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  const { data: eventosData } = useQuery({ queryKey: ['eventos'], queryFn: api.eventos, refetchInterval: 15000 });
  const eventos = eventosData?.eventos || [];

  useEffect(() => {
    if (!eventoId && eventos.length) {
      const ativo = eventos.filter((e) => !e.arquivado).sort((a, b) => a.ordem - b.ordem)[0];
      if (ativo) setEventoId(ativo.id);
    }
  }, [eventos, eventoId]);

  const eventoAtual = eventos.find((e) => e.id === eventoId);
  const readOnly = !!eventoAtual?.arquivado;

  const { data, isError, isFetching, isLoading } = useQuery({
    queryKey: ['participantes', eventoId],
    queryFn: () => api.listar(eventoId),
    enabled: !!eventoId,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });
  const lista = data?.list || [];

  const credenciarMut = useMutation({
    mutationFn: async ({ id, credenciado }) => {
      try { return await api.credenciar(id, credenciado); }
      catch (e) {
        if (!navigator.onLine || e?.code === 'network') {
          enfileirar({ id, credenciado }); setPendentes(tamanhoFila());
          return { offline: true };
        }
        throw e;
      }
    },
    onMutate: async ({ id, credenciado }) => {
      await qc.cancelQueries({ queryKey: ['participantes', eventoId] });
      const prev = qc.getQueryData(['participantes', eventoId]);
      qc.setQueryData(['participantes', eventoId], (old) => old && {
        ...old, list: old.list.map((p) => (p.id === id ? { ...p, credenciado, recebeuCracha: credenciado } : p)),
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['participantes', eventoId], ctx.prev); beepErr(); toast('Erro ao salvar', 'danger'); },
    onSuccess: (d, { credenciado, nome }) => {
      if (credenciado) beepOk();
      if (d && d.offline) toast(`✓ ${nome} (salvo offline — sincroniza ao reconectar)`, 'success');
      else toast(credenciado ? `✓ ${nome} credenciado(a)!` : `${nome} marcado como pendente`, credenciado ? 'success' : '');
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['participantes', eventoId] }); qc.invalidateQueries({ queryKey: ['eventos'] }); },
  });

  const filtrada = useMemo(() => {
    const q = norm(busca.trim());
    const arr = lista.filter((x) => {
      if (filtro === 'credenciados' && !x.credenciado) return false;
      if (filtro === 'pendentes' && x.credenciado) return false;
      if (tipoFiltro !== 'todos' && x.tipo !== tipoFiltro) return false;
      if (!q) return true;
      return norm(x.nome).includes(q) || norm(x.email).includes(q) || norm(x.turma).includes(q)
        || norm(x.telefone).includes(q) || norm(x.nomeCracha).includes(q) || norm(x.convidadoPor).includes(q);
    });
    arr.sort((a, b) => {
      if (ordem === 'nome') return a.nome.localeCompare(b.nome, 'pt-BR');
      if (ordem === 'nome-desc') return b.nome.localeCompare(a.nome, 'pt-BR');
      if (ordem === 'turma') return (a.turma || '').localeCompare(b.turma || '', 'pt-BR', { numeric: true });
      if (ordem === 'tipo') return (a.tipo || '').localeCompare(b.tipo || '') || a.nome.localeCompare(b.nome, 'pt-BR');
      if (ordem === 'credenciado-first') return (b.credenciado - a.credenciado) || a.nome.localeCompare(b.nome, 'pt-BR');
      if (ordem === 'pendente-first') return (a.credenciado - b.credenciado) || a.nome.localeCompare(b.nome, 'pt-BR');
      return 0;
    });
    return arr;
  }, [lista, busca, filtro, tipoFiltro, ordem]);

  const total = lista.length;
  const cred = lista.filter((x) => x.credenciado).length;
  const pend = total - cred;
  const pct = total ? Math.round((cred / total) * 100) : 0;

  const sync = isError ? { k: 'err', t: 'Erro de conexão' }
    : isFetching ? { k: 'warn', t: 'Sincronizando…' }
    : { k: 'ok', t: `Sincronizado · ${horaAgora()}` };

  async function exportar() {
    try {
      const d = await api.exportar(eventoId);
      const blob = new Blob([JSON.stringify(d.list, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      const date = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      a.href = URL.createObjectURL(blob);
      a.download = `credenciamento-${eventoId}-${date}.json`;
      a.click(); URL.revokeObjectURL(a.href);
      toast('Backup exportado', 'success');
    } catch { toast('Erro ao exportar', 'danger'); }
  }
  function abrirImport() { fileRef.current?.click(); }
  function onImportFile(e) {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const arr = JSON.parse(reader.result);
        if (!Array.isArray(arr)) throw 0;
        if (!confirm(`Importar ${arr.length} registros para "${eventoAtual?.nome}"? Isso substitui a lista deste evento.`)) return;
        await api.importar(eventoId, arr);
        qc.invalidateQueries({ queryKey: ['participantes', eventoId] });
        qc.invalidateQueries({ queryKey: ['eventos'] });
        toast('Importado com sucesso', 'success');
      } catch { toast('Arquivo inválido', 'danger'); }
    };
    reader.readAsText(file);
  }

  // Leitura de QR -> credencia pelo id embutido (em qualquer evento).
  async function aoEscanear(id) {
    try {
      const det = await api.detalhe(id);
      if (det.credenciado) {
        beepOk(); // confirma a leitura, sem toast global (evita aviso repetido)
        return { ok: true, msg: `${det.nome} — já credenciado` };
      }
      await api.credenciar(id, true);
      beepOk(); toast(`✓ ${det.nome} credenciado(a)!`, 'success');
      qc.invalidateQueries({ queryKey: ['participantes', det.evento_id] });
      qc.invalidateQueries({ queryKey: ['participantes', eventoId] });
      qc.invalidateQueries({ queryKey: ['eventos'] });
      return { ok: true, msg: `✓ ${det.nome} credenciado` };
    } catch {
      beepErr();
      return { ok: false, msg: 'QR não reconhecido' };
    }
  }

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand">
            <img className="brand-logo" src="/thb-logo.png" alt="Time Holding Brasil" />
            <div>
              <h1>Credenciamento THB</h1>
              <p>Time Holding Brasil</p>
            </div>
          </div>
          <div className="header-actions">
            {!readOnly && <button className="btn" onClick={() => setScanOpen(true)} title="Ler QR do crachá"><IconSearch /> Escanear</button>}
            {!readOnly && <button className="btn ghost" onClick={abrirImport} title="Importar JSON"><IconImport /> Importar</button>}
            <button className="btn ghost" onClick={() => setDashOpen(true)} title="Painel do evento">📊 Painel</button>
            <button className="btn ghost" onClick={exportar} title="Exportar JSON"><IconExport /> Exportar</button>
            {!readOnly && <button className="btn primary" onClick={() => { setNovoNome(''); setEditando(null); }}><IconPlus /> Novo participante</button>}
            <span className="op-chip"><span className="who">{operador}</span>
              <button className="logout" title="Sair" onClick={onLogout}><IconLogout /></button></span>
          </div>
        </div>
      </header>

      <EventBar eventos={eventos} eventoId={eventoId} onSelect={setEventoId} onOpenHistory={() => setHistOpen(true)} />

      {readOnly && (
        <div className="readonly-banner">
          Visualizando <strong>{eventoAtual?.nome}</strong> (histórico — somente leitura).
          <button className="btn ghost" onClick={() => {
            const ativo = eventos.filter((e) => !e.arquivado).sort((a, b) => a.ordem - b.ordem)[0];
            if (ativo) setEventoId(ativo.id);
          }}>Voltar aos eventos ativos</button>
        </div>
      )}

      {(!online || pendentes > 0) && (
        <div className="offline-banner">
          {!online && <span>⚠ Sem conexão — credenciamentos ficam salvos no aparelho.</span>}
          {pendentes > 0 && <span> {pendentes} pendente(s) de sincronização.</span>}
        </div>
      )}

      <section className="stats">
        <div className="stat"><div className="label">Total na lista</div><div className="value">{total}</div><div className="hint">{eventoAtual?.nome || '—'}</div></div>
        <div className="stat ok"><div className="label">Credenciados</div><div className="value">{cred}</div><div className="progress"><div className="bar" style={{ width: `${pct}%` }} /></div></div>
        <div className="stat warn"><div className="label">Pendentes</div><div className="value">{pend}</div><div className="hint">Ainda não chegaram</div></div>
        <div className="stat acc"><div className="label">Progresso</div><div className="value">{pct}%</div><div className="hint">{cred} de {total}</div></div>
      </section>

      <div className="toolbar">
        <div className="search">
          <IconSearch />
          <input ref={searchRef} value={busca} onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !readOnly && filtrada.length === 1) {
                const alvo = filtrada[0];
                if (!alvo.credenciado) credenciarMut.mutate({ id: alvo.id, credenciado: true, nome: alvo.nome });
              }
            }}
            placeholder="Buscar por nome, e-mail, turma, telefone, quem convidou…  (atalho: / )" autoComplete="off" />
        </div>
        <div className="filter">
          {[['todos', 'Todos'], ['pendentes', 'Pendentes'], ['credenciados', 'Credenciados']].map(([f, label]) => (
            <button key={f} className={filtro === f ? 'active' : ''} onClick={() => setFiltro(f)}>{label}</button>
          ))}
        </div>
        <select className="btn" style={{ paddingRight: 28 }} value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value)}>
          <option value="todos">Tipo: Todos</option>
          <option value="comum">Comum</option>
          <option value="socio">Sócio</option>
          <option value="diamante">Diamante</option>
          <option value="convidado">Convidado</option>
        </select>
        <select className="btn" style={{ paddingRight: 28 }} value={ordem} onChange={(e) => setOrdem(e.target.value)}>
          <option value="nome">Ordenar: Nome (A→Z)</option>
          <option value="nome-desc">Nome (Z→A)</option>
          <option value="turma">Turma</option>
          <option value="tipo">Tipo</option>
          <option value="credenciado-first">Credenciados primeiro</option>
          <option value="pendente-first">Pendentes primeiro</option>
        </select>
      </div>

      <main className="list-wrap">
        <div className="count-row">
          <span>{filtrada.length} {filtrada.length === 1 ? 'participante' : 'participantes'}</span>
          <span className={`sync-dot ${sync.k}`}><span className="dot" />{sync.t}</span>
        </div>
        <div className="table-wrap">
          <div className="table-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 170 }}>Status</th>
                  <th>Participante</th>
                  <th>Tipo</th>
                  <th>Turma</th>
                  <th>Instrução</th>
                  <th>Contato</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtrada.map((p) => (
                  <Linha key={p.id} p={p} readOnly={readOnly}
                    onToggle={() => credenciarMut.mutate({ id: p.id, credenciado: !p.credenciado, nome: p.nome })}
                    onEdit={() => setEditando(p)}
                    onDetail={() => setDetalheId(p.id)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {!isLoading && filtrada.length === 0 && (
          <div className="empty">
            <IconSearch />
            <div>Nenhum participante encontrado{busca ? ` para "${busca}"` : ''}.</div>
            {busca.trim() && !readOnly && (
              <button className="btn primary" style={{ marginTop: 14 }} onClick={() => { setNovoNome(busca.trim()); setEditando(null); }}>
                <IconPlus /> Cadastrar "{busca.trim()}" neste evento
              </button>
            )}
          </div>
        )}
      </main>

      <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onImportFile} />

      {editando !== undefined && (
        <ParticipantModal participant={editando} eventoId={eventoId} nomeInicial={novoNome} onClose={() => setEditando(undefined)} />
      )}
      {detalheId && (
        <DetailModal participantId={detalheId}
          eventos={eventos}
          readOnly={readOnly}
          onClose={() => setDetalheId(null)}
          onEdit={readOnly ? null : (p) => { setDetalheId(null); setEditando(p); }}
          onCredenciar={readOnly ? null : (id, novo, nome) => credenciarMut.mutateAsync({ id, credenciado: novo, nome })}
          onOpenByName={(nome) => {
            const alvo = norm(nome);
            const achado = lista.find((x) => norm(x.nome) === alvo) || lista.find((x) => norm(x.nome).includes(alvo));
            if (achado) setDetalheId(achado.id);
            else toast('Essa pessoa não está nesta lista do evento.', 'danger');
          }} />
      )}
      {histOpen && (
        <HistoryModal eventos={eventos} onClose={() => setHistOpen(false)}
          onOpen={(id) => { setEventoId(id); setHistOpen(false); }} />
      )}
      {scanOpen && <ScannerModal onDetected={aoEscanear} onClose={() => setScanOpen(false)} />}
      {dashOpen && <DashboardModal eventoId={eventoId} eventoNome={eventoAtual?.nome || ''} lista={lista} onClose={() => setDashOpen(false)} />}
    </>
  );
}

function Linha({ p, readOnly, onToggle, onEdit, onDetail }) {
  const telClean = (p.telefone || '').replace(/\D/g, '');
  return (
    <tr className={p.credenciado ? 'credenciado' : ''}>
      <td>
        <button className={`check-btn ${p.credenciado ? 'on' : ''}`} onClick={onToggle} disabled={readOnly}>
          {p.credenciado ? <><IconCheck /> Credenciado</> : <><IconSquare /> Credenciar</>}
        </button>
      </td>
      <td>
        <div className="cell-nome">
          <div className={`avatar avatar-${tipoCls(p.tipo)}`}>{initials(p.nome)}</div>
          <div className="name-wrap">
            <div className="name">
              <button type="button" className="name-btn" onClick={onDetail}>{p.nome || '—'}</button>
            </div>
            <div className="name-sub">
              {p.nomeCracha || ''}{p.profissao ? ` · ${p.profissao}` : ''}
              {p.convidadoPor ? ` · convidado por ${p.convidadoPor}` : ''}
            </div>
          </div>
        </div>
      </td>
      <td>
        <span className={`tbadge tbadge-${tipoCls(p.tipo)}`}>{tipoLabel(p.tipo)}</span>
        {p.grupoDiamante && <div className="grupo-dia">{p.grupoDiamante}</div>}
      </td>
      <td>{p.turma ? <span className="badge turma">{p.turma}</span> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
      <td>{p.instrucao ? <span className="badge inst">{p.instrucao}</span> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
      <td>
        <div className="contact">
          {p.telefone ? <a href={`https://wa.me/${telClean}`} target="_blank" rel="noopener noreferrer">{p.telefone}</a> : <small>sem telefone</small>}
          {p.email && <small>{p.email}</small>}
        </div>
      </td>
      <td>
        <div className="actions-cell">
          <button className="icon-btn" onClick={onDetail} title="Ver detalhes"><IconSearch /></button>
          {!readOnly && <button className="icon-btn" onClick={onEdit} title="Editar"><IconEdit /></button>}
        </div>
      </td>
    </tr>
  );
}
