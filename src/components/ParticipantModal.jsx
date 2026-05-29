import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { useToast } from './Toasts.jsx';
import { IconClose } from '../icons.jsx';

const VAZIO = {
  nome: '', nomeCracha: '', email: '', telefone: '', turma: '', profissao: '',
  tamanhoCamisa: '', dataChegada: '', dataRetorno: '', instrucao: '', observacoes: '',
};

export default function ParticipantModal({ participant, onClose }) {
  const isNew = !participant;
  const qc = useQueryClient();
  const toast = useToast();

  const [form, setForm] = useState(VAZIO);
  const [foto, setFoto] = useState('');
  const fotoOriginal = useRef('');
  const [salvando, setSalvando] = useState(false);

  // Preenche o formulário e carrega a foto sob demanda.
  useEffect(() => {
    if (isNew) {
      setForm(VAZIO);
      setFoto('');
      fotoOriginal.current = '';
      return;
    }
    setForm({ ...VAZIO, ...participant });
    setFoto('');
    fotoOriginal.current = '';
    if (participant.temFoto) {
      api.getFoto(participant.id)
        .then((d) => { setFoto(d.foto || ''); fotoOriginal.current = d.foto || ''; })
        .catch(() => {});
    }
  }, [participant, isNew]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function onPickFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Selecione uma imagem válida', 'danger'); return; }
    const reader = new FileReader();
    reader.onload = () => setFoto(reader.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  async function submit(e) {
    e.preventDefault();
    const nome = form.nome.trim();
    if (!nome) { toast('Informe o nome', 'danger'); return; }

    setSalvando(true);
    try {
      const dados = { ...form, nome };
      let id;
      if (isNew) {
        const criado = await api.criar(dados);
        id = criado.id;
        toast('Participante adicionado', 'success');
      } else {
        id = participant.id;
        await api.atualizar(id, dados);
        toast('Participante atualizado', 'success');
      }
      // Salva a foto só se mudou (evita tráfego à toa).
      if (foto !== fotoOriginal.current) await api.setFoto(id, foto);

      await qc.invalidateQueries({ queryKey: ['participantes'] });
      onClose();
    } catch (err) {
      toast('Erro ao salvar. Tente novamente.', 'danger');
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!participant) return;
    if (!confirm(`Excluir "${participant.nome}" da lista?`)) return;
    setSalvando(true);
    try {
      await api.excluir(participant.id);
      await qc.invalidateQueries({ queryKey: ['participantes'] });
      toast('Participante excluído', 'danger');
      onClose();
    } catch {
      toast('Erro ao excluir', 'danger');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{isNew ? 'Adicionar participante' : 'Editar participante'}</h3>
          <button className="icon-btn" onClick={onClose} title="Fechar"><IconClose /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="field">
              <label>Nome completo *</label>
              <input value={form.nome} onChange={set('nome')} autoFocus required />
            </div>
            <div className="field-row">
              <div className="field"><label>Nome do crachá</label><input value={form.nomeCracha} onChange={set('nomeCracha')} /></div>
              <div className="field"><label>Turma</label><input value={form.turma} onChange={set('turma')} placeholder="Ex: T37" /></div>
            </div>
            <div className="field-row">
              <div className="field"><label>E-mail</label><input type="email" value={form.email} onChange={set('email')} /></div>
              <div className="field"><label>Telefone</label><input value={form.telefone} onChange={set('telefone')} /></div>
            </div>
            <div className="field-row">
              <div className="field"><label>Profissão</label><input value={form.profissao} onChange={set('profissao')} /></div>
              <div className="field">
                <label>Tamanho camisa</label>
                <select value={form.tamanhoCamisa} onChange={set('tamanhoCamisa')}>
                  <option value=""></option>
                  <option>P</option><option>M</option><option>G</option><option>GG</option><option>XG</option>
                </select>
              </div>
            </div>
            <div className="field-row">
              <div className="field"><label>Data de chegada</label><input value={form.dataChegada} onChange={set('dataChegada')} placeholder="dd/mm/aaaa" /></div>
              <div className="field"><label>Data de retorno</label><input value={form.dataRetorno} onChange={set('dataRetorno')} placeholder="dd/mm/aaaa" /></div>
            </div>
            <div className="field"><label>Instrução / nível</label><input value={form.instrucao} onChange={set('instrucao')} placeholder="THB, AURUM, PLATINA…" /></div>
            <div className="field">
              <label>Foto do participante</label>
              <div className="photo-preview-wrap">
                <div className="photo-preview">
                  {foto ? <img src={foto} alt="Prévia da foto" /> : 'Sem foto'}
                </div>
                <div className="photo-actions">
                  <label className="btn">
                    Selecionar foto
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickFile} />
                  </label>
                  <button type="button" className="btn ghost danger" onClick={() => setFoto('')}>Remover foto</button>
                </div>
              </div>
              <div className="photo-help">Ao clicar no nome da pessoa na lista, a foto será aberta.</div>
            </div>
            <div className="field"><label>Observações</label><textarea value={form.observacoes} onChange={set('observacoes')} /></div>
          </div>
          <div className="modal-foot">
            {!isNew && (
              <button type="button" className="btn danger ghost" style={{ marginRight: 'auto' }} onClick={excluir} disabled={salvando}>
                Excluir
              </button>
            )}
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn primary" disabled={salvando}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
