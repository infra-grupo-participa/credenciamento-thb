import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { useToast } from './Toasts.jsx';
import { IconClose } from '../icons.jsx';

export default function SettingsModal({ eventos, onClose }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [aba, setAba] = useState('eventos');

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>Configurações</h3>
          <button className="icon-btn" onClick={onClose} title="Fechar"><IconClose /></button>
        </div>
        <div className="modal-body">
          <div className="tabs">
            <button className={aba === 'eventos' ? 'active' : ''} onClick={() => setAba('eventos')}>Eventos</button>
            <button className={aba === 'operadores' ? 'active' : ''} onClick={() => setAba('operadores')}>Operadores</button>
            <button className={aba === 'senha' ? 'active' : ''} onClick={() => setAba('senha')}>Senha</button>
          </div>
          {aba === 'eventos' && <AbaEventos eventos={eventos} qc={qc} toast={toast} />}
          {aba === 'operadores' && <AbaOperadores toast={toast} />}
          {aba === 'senha' && <AbaSenha toast={toast} />}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn primary" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

function AbaEventos({ eventos, qc, toast }) {
  const [novo, setNovo] = useState({ nome: '', tipo: 'clinica', data: '', ordem: '' });
  const [salvando, setSalvando] = useState('');

  async function salvar(ev, campos) {
    setSalvando(ev.id);
    try { await api.atualizarEvento(ev.id, campos); await qc.invalidateQueries({ queryKey: ['eventos'] }); toast('Evento atualizado', 'success'); }
    catch { toast('Erro ao salvar evento', 'danger'); }
    finally { setSalvando(''); }
  }
  async function criar() {
    if (!novo.nome.trim()) { toast('Informe o nome do evento', 'danger'); return; }
    setSalvando('novo');
    try {
      await api.criarEvento({ ...novo, ordem: Number(novo.ordem) || (eventos.length) });
      await qc.invalidateQueries({ queryKey: ['eventos'] });
      setNovo({ nome: '', tipo: 'clinica', data: '', ordem: '' });
      toast('Evento criado', 'success');
    } catch { toast('Erro ao criar evento', 'danger'); }
    finally { setSalvando(''); }
  }

  return (
    <div>
      {eventos.sort((a, b) => a.ordem - b.ordem).map((e) => <LinhaEvento key={e.id} ev={e} onSalvar={salvar} salvando={salvando === e.id} />)}
      <div className="detail-section">Novo evento</div>
      <div className="ev-form">
        <input placeholder="Nome (ex: Clínica — Dia 3)" value={novo.nome} onChange={(ev) => setNovo({ ...novo, nome: ev.target.value })} />
        <select value={novo.tipo} onChange={(ev) => setNovo({ ...novo, tipo: ev.target.value })}>
          <option value="imersao">Imersão</option>
          <option value="clinica">Clínica</option>
          <option value="passado">Passado</option>
        </select>
        <input type="date" value={novo.data} onChange={(ev) => setNovo({ ...novo, data: ev.target.value })} />
        <input style={{ width: 70 }} placeholder="ordem" value={novo.ordem} onChange={(ev) => setNovo({ ...novo, ordem: ev.target.value })} />
        <button className="btn primary" onClick={criar} disabled={salvando === 'novo'}>Criar</button>
      </div>
    </div>
  );
}

function LinhaEvento({ ev, onSalvar, salvando }) {
  const [f, setF] = useState({ nome: ev.nome, data: ev.data || '', ordem: ev.ordem, ativo: ev.ativo, arquivado: ev.arquivado });
  return (
    <div className="ev-row">
      <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
      <input type="date" value={f.data || ''} onChange={(e) => setF({ ...f, data: e.target.value })} />
      <input style={{ width: 56 }} value={f.ordem} onChange={(e) => setF({ ...f, ordem: Number(e.target.value) || 0 })} title="Ordem" />
      <label className="ev-chk"><input type="checkbox" checked={!!f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Ativo</label>
      <label className="ev-chk"><input type="checkbox" checked={!!f.arquivado} onChange={(e) => setF({ ...f, arquivado: e.target.checked })} /> Histórico</label>
      <button className="btn mini" onClick={() => onSalvar(ev, f)} disabled={salvando}>Salvar</button>
    </div>
  );
}

function AbaOperadores({ toast }) {
  const [lista, setLista] = useState(null);
  const [nome, setNome] = useState('');
  useEffect(() => { api.getConfig('operadores').then((r) => setLista(Array.isArray(r.v) ? r.v : [])).catch(() => setLista([])); }, []);
  async function gravar(novaLista) {
    setLista(novaLista);
    try { await api.setConfig('operadores', novaLista); } catch { toast('Erro ao salvar operadores', 'danger'); }
  }
  if (lista === null) return <div className="center-screen" style={{ minHeight: 100 }}><div className="spinner" /></div>;
  return (
    <div>
      <p className="cfg-title">Operadores aparecem como sugestão na tela de login.</p>
      <div className="op-list">
        {lista.map((n) => (
          <span className="op-tag" key={n}>{n}<button onClick={() => gravar(lista.filter((x) => x !== n))} title="Remover">×</button></span>
        ))}
        {lista.length === 0 && <span className="cfg-title">Nenhum operador cadastrado.</span>}
      </div>
      <div className="ev-form" style={{ marginTop: 10 }}>
        <input placeholder="Nome do operador" value={nome} onChange={(e) => setNome(e.target.value)} />
        <button className="btn primary" onClick={() => { const n = nome.trim(); if (n && !lista.includes(n)) { gravar([...lista, n]); setNome(''); } }}>Adicionar</button>
      </div>
    </div>
  );
}

function AbaSenha({ toast }) {
  const [s1, setS1] = useState(''); const [s2, setS2] = useState(''); const [salvando, setSalvando] = useState(false);
  async function salvar() {
    if (s1.length < 4) { toast('A senha precisa de pelo menos 4 caracteres', 'danger'); return; }
    if (s1 !== s2) { toast('As senhas não conferem', 'danger'); return; }
    setSalvando(true);
    try { await api.trocarSenha(s1); toast('Senha do evento atualizada', 'success'); setS1(''); setS2(''); }
    catch { toast('Erro ao trocar a senha', 'danger'); }
    finally { setSalvando(false); }
  }
  return (
    <div>
      <p className="cfg-title">Define a senha que todos os operadores usam para entrar (vale imediatamente para novos logins).</p>
      <div className="field"><label>Nova senha</label><input type="password" value={s1} onChange={(e) => setS1(e.target.value)} /></div>
      <div className="field"><label>Confirmar senha</label><input type="password" value={s2} onChange={(e) => setS2(e.target.value)} /></div>
      <button className="btn primary" onClick={salvar} disabled={salvando}>Salvar nova senha</button>
    </div>
  );
}
