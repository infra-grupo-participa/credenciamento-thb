import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, auth } from './api.js';
import { useToast } from './components/Toasts.jsx';
import Login from './components/Login.jsx';
import ParticipantModal from './components/ParticipantModal.jsx';
import PhotoModal from './components/PhotoModal.jsx';
import {
  IconImport, IconExport, IconPlus, IconSearch, IconReset,
  IconCheck, IconSquare, IconEdit, IconLogout,
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

  if (checando) {
    return <div className="center-screen"><div className="spinner" /></div>;
  }
  if (!operador) {
    return <Login onLogin={(nome) => { setOperador(nome); setChecando(false); }} />;
  }
  return <Credenciamento operador={operador} onLogout={() => { auth.clear(); setOperador(null); }} />;
}

function Credenciamento({ operador, onLogout }) {
  const qc = useQueryClient();
  const toast = useToast();

  const [filtro, setFiltro] = useState('todos');
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState('nome');
  const [editando, setEditando] = useState(undefined); // undefined=fechado, null=novo, obj=editar
  const [fotoDe, setFotoDe] = useState(null);
  const fileRef = useRef(null);

  const { data, isError, isFetching, isLoading } = useQuery({
    queryKey: ['participantes'],
    queryFn: api.listar,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });

  const lista = data?.list || [];

  const credenciarMut = useMutation({
    mutationFn: ({ id, credenciado }) => api.credenciar(id, credenciado),
    onMutate: async ({ id, credenciado }) => {
      await qc.cancelQueries({ queryKey: ['participantes'] });
      const prev = qc.getQueryData(['participantes']);
      qc.setQueryData(['participantes'], (old) => old && {
        ...old,
        list: old.list.map((p) => (p.id === id ? { ...p, credenciado, recebeuCracha: credenciado } : p)),
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['participantes'], ctx.prev); toast('Erro ao salvar', 'danger'); },
    onSuccess: (_d, { credenciado, nome }) =>
      toast(credenciado ? `✓ ${nome} credenciado(a)!` : `${nome} marcado como pendente`, credenciado ? 'success' : ''),
    onSettled: () => qc.invalidateQueries({ queryKey: ['participantes'] }),
  });

  const filtrada = useMemo(() => {
    const q = norm(busca.trim());
    const arr = lista.filter((x) => {
      if (filtro === 'credenciados' && !x.credenciado) return false;
      if (filtro === 'pendentes' && x.credenciado) return false;
      if (!q) return true;
      return norm(x.nome).includes(q) || norm(x.email).includes(q) || norm(x.turma).includes(q)
        || norm(x.telefone).includes(q) || norm(x.nomeCracha).includes(q);
    });
    arr.sort((a, b) => {
      if (ordem === 'nome') return a.nome.localeCompare(b.nome, 'pt-BR');
      if (ordem === 'nome-desc') return b.nome.localeCompare(a.nome, 'pt-BR');
      if (ordem === 'turma') return (a.turma || '').localeCompare(b.turma || '', 'pt-BR', { numeric: true });
      if (ordem === 'credenciado-first') return (b.credenciado - a.credenciado) || a.nome.localeCompare(b.nome, 'pt-BR');
      if (ordem === 'pendente-first') return (a.credenciado - b.credenciado) || a.nome.localeCompare(b.nome, 'pt-BR');
      return 0;
    });
    return arr;
  }, [lista, busca, filtro, ordem]);

  const total = lista.length;
  const cred = lista.filter((x) => x.credenciado).length;
  const pend = total - cred;
  const pct = total ? Math.round((cred / total) * 100) : 0;

  const sync = isError ? { k: 'err', t: 'Erro de conexão' }
    : isFetching ? { k: 'warn', t: 'Sincronizando…' }
    : { k: 'ok', t: `Sincronizado · ${horaAgora()}` };

  async function exportar() {
    try {
      const d = await api.exportar();
      const blob = new Blob([JSON.stringify(d.list, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      const date = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      a.href = URL.createObjectURL(blob);
      a.download = `credenciamento-chf2026-${date}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Backup exportado', 'success');
    } catch { toast('Erro ao exportar', 'danger'); }
  }

  function abrirImport() { fileRef.current?.click(); }
  function onImportFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const arr = JSON.parse(reader.result);
        if (!Array.isArray(arr)) throw 0;
        if (!confirm(`Importar ${arr.length} registros? Isso substituirá a lista atual.`)) return;
        await api.importar(arr);
        await qc.invalidateQueries({ queryKey: ['participantes'] });
        toast('Backup importado com sucesso', 'success');
      } catch { toast('Arquivo inválido', 'danger'); }
    };
    reader.readAsText(file);
  }

  async function resetar() {
    if (!confirm('Isso vai restaurar a lista oficial e apagar TODAS as alterações (credenciamentos, adições, edições). Continuar?')) return;
    try {
      await api.resetar();
      await qc.invalidateQueries({ queryKey: ['participantes'] });
      toast('Dados restaurados', 'success');
    } catch { toast('Erro ao restaurar', 'danger'); }
  }

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand">
            <img className="brand-logo" src="/thb-logo.png" alt="Time Holding Brasil" />
            <div>
              <h1>Credenciamento CHF 2026</h1>
              <p>Clínica do Holding Familiar · Goiânia</p>
            </div>
          </div>
          <div className="header-actions">
            <button className="btn ghost" onClick={abrirImport} title="Importar backup JSON"><IconImport /> Importar</button>
            <button className="btn ghost" onClick={exportar} title="Exportar backup JSON"><IconExport /> Exportar</button>
            <button className="btn primary" onClick={() => setEditando(null)}><IconPlus /> Novo participante</button>
            <span className="op-chip">
              <span className="who">{operador}</span>
              <button className="logout" title="Sair" onClick={onLogout}><IconLogout /></button>
            </span>
          </div>
        </div>
      </header>

      <section className="stats">
        <div className="stat">
          <div className="label">Total de inscritos</div>
          <div className="value">{total}</div>
          <div className="hint">Lista oficial + manuais</div>
        </div>
        <div className="stat ok">
          <div className="label">Credenciados</div>
          <div className="value">{cred}</div>
          <div className="progress"><div className="bar" style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="stat warn">
          <div className="label">Pendentes</div>
          <div className="value">{pend}</div>
          <div className="hint">Ainda não chegaram / sem crachá</div>
        </div>
        <div className="stat acc">
          <div className="label">Progresso</div>
          <div className="value">{pct}%</div>
          <div className="hint">{cred} de {total} credenciados</div>
        </div>
      </section>

      <div className="toolbar">
        <div className="search">
          <IconSearch />
          <input value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, e-mail, turma, telefone…" autoComplete="off" />
        </div>
        <div className="filter">
          {[['todos', 'Todos'], ['pendentes', 'Pendentes'], ['credenciados', 'Credenciados']].map(([f, label]) => (
            <button key={f} className={filtro === f ? 'active' : ''} onClick={() => setFiltro(f)}>{label}</button>
          ))}
        </div>
        <select className="btn" style={{ paddingRight: 28 }} value={ordem} onChange={(e) => setOrdem(e.target.value)}>
          <option value="nome">Ordenar: Nome (A→Z)</option>
          <option value="nome-desc">Nome (Z→A)</option>
          <option value="turma">Turma</option>
          <option value="credenciado-first">Credenciados primeiro</option>
          <option value="pendente-first">Pendentes primeiro</option>
        </select>
      </div>

      <main className="list-wrap">
        <div className="count-row">
          <span>{filtrada.length} {filtrada.length === 1 ? 'participante' : 'participantes'}</span>
          <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className={`sync-dot ${sync.k}`}><span className="dot" />{sync.t}</span>
            <button className="btn ghost danger" onClick={resetar} title="Restaurar lista original">
              <IconReset /> Resetar dados
            </button>
          </span>
        </div>
        <div className="table-wrap">
          <div className="table-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 170 }}>Status</th>
                  <th>Participante</th>
                  <th>Turma</th>
                  <th>Camisa</th>
                  <th>Instrução</th>
                  <th>Contato</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtrada.map((p) => (
                  <Linha key={p.id} p={p}
                    onToggle={() => credenciarMut.mutate({ id: p.id, credenciado: !p.credenciado, nome: p.nome })}
                    onEdit={() => setEditando(p)}
                    onFoto={() => setFotoDe(p)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {!isLoading && filtrada.length === 0 && (
          <div className="empty">
            <IconSearch />
            <div>Nenhum participante encontrado.</div>
          </div>
        )}
      </main>

      <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onImportFile} />

      {editando !== undefined && (
        <ParticipantModal participant={editando} onClose={() => setEditando(undefined)} />
      )}
      {fotoDe && <PhotoModal participant={fotoDe} onClose={() => setFotoDe(null)} />}
    </>
  );
}

function Linha({ p, onToggle, onEdit, onFoto }) {
  const isManual = p.id && p.id.startsWith('m-');
  const telClean = (p.telefone || '').replace(/\D/g, '');
  return (
    <tr className={p.credenciado ? 'credenciado' : ''}>
      <td>
        <button className={`check-btn ${p.credenciado ? 'on' : ''}`} onClick={onToggle}>
          {p.credenciado ? <><IconCheck /> Credenciado</> : <><IconSquare /> Credenciar</>}
        </button>
      </td>
      <td>
        <div className="cell-nome">
          <div className="avatar">{initials(p.nome)}</div>
          <div className="name-wrap">
            <div className="name">
              <button type="button" className="name-btn" onClick={onFoto}>{p.nome || '—'}</button>
              {isManual && <span className="badge new" style={{ marginLeft: 6 }}>novo</span>}
            </div>
            <div className="name-sub">{p.nomeCracha || ''} {p.profissao ? `· ${p.profissao}` : ''}</div>
          </div>
        </div>
      </td>
      <td>{p.turma ? <span className="badge turma">{p.turma}</span> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
      <td>{p.tamanhoCamisa ? <span className="badge size">{p.tamanhoCamisa}</span> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
      <td>{p.instrucao ? <span className="badge inst">{p.instrucao}</span> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
      <td>
        <div className="contact">
          {p.telefone ? <a href={`https://wa.me/${telClean}`} target="_blank" rel="noopener noreferrer">{p.telefone}</a> : <small>sem telefone</small>}
          {p.email && <small>{p.email}</small>}
        </div>
      </td>
      <td>
        <div className="actions-cell">
          <button className="icon-btn" onClick={onEdit} title="Editar"><IconEdit /></button>
        </div>
      </td>
    </tr>
  );
}
