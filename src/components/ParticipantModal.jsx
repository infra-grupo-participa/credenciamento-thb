import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { useToast } from './Toasts.jsx';
import { IconClose } from '../icons.jsx';

const VAZIO = {
  nome: '', nomeCracha: '', email: '', telefone: '', documento: '', turma: '', profissao: '',
  tamanhoCamisa: '', dataChegada: '', dataRetorno: '', instrucao: '', observacoes: '',
  // Mesmo default do walk-in do scanner: quem é cadastrado na hora quase sempre comprou.
  // "comum" deixaria a pessoa invisível no filtro de Tipo (só oferece comprador/convidado).
  tipo: 'comprador', convidadoPor: '', cidade: '', estado: '', nivel: '', grupo: '', grupoDiamante: '',
};

export default function ParticipantModal({ participant, eventoId, nomeInicial = '', onClose }) {
  const isNew = !participant;
  const qc = useQueryClient();
  const toast = useToast();

  const [form, setForm] = useState(VAZIO);
  const full = useRef(null);   // detalhe completo (preserva campos não editáveis)
  const [foto, setFoto] = useState('');
  const fotoOriginal = useRef('');
  const [salvando, setSalvando] = useState(false);
  // Representante: participa/recebe o e-mail no lugar do comprador (opt-in manual).
  const REP_VAZIO = { nome: '', email: '', telefone: '', documento: '' };
  const [temRep, setTemRep] = useState(false);
  const [rep, setRep] = useState(REP_VAZIO);

  useEffect(() => {
    full.current = null;
    setFoto(''); fotoOriginal.current = '';
    setTemRep(false); setRep(REP_VAZIO);
    if (isNew) { setForm({ ...VAZIO, nome: nomeInicial || '' }); return; }
    setForm({ ...VAZIO, ...participant });
    if (participant.representante) { setTemRep(true); setRep({ ...REP_VAZIO, ...participant.representante }); }
    // Carrega o detalhe completo para não perder campos fora da lista leve.
    api.detalhe(participant.id).then((d) => {
      full.current = d;
      setForm((f) => ({ ...VAZIO, ...d, ...f, nome: d.nome ?? f.nome }));
      if (d.representante) { setTemRep(true); setRep({ ...REP_VAZIO, ...d.representante }); }
      if (d.temFoto) api.getFoto(participant.id).then((r) => { setFoto(r.foto || ''); fotoOriginal.current = r.foto || ''; }).catch(() => {});
    }).catch(() => {});
  }, [participant, isNew]);

  const setR = (k) => (e) => setRep((r) => ({ ...r, [k]: e.target.value }));

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
      // Mescla: preserva campos do detalhe (documento, cidade, nível...) + edições do form.
      // Representante só é gravado quando a opção está marcada; senão limpa (null).
      const representante = temRep ? rep : null;
      const dados = { ...(full.current || {}), ...form, nome, evento_id: eventoId, representante };
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
      if (foto !== fotoOriginal.current) await api.setFoto(id, foto);
      await qc.invalidateQueries({ queryKey: ['participantes', eventoId] });
      await qc.invalidateQueries({ queryKey: ['eventos'] });
      onClose();
    } catch {
      toast('Erro ao salvar. Tente novamente.', 'danger');
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!participant) return;
    // Apaga a pessoa e todo o rastro dela neste dia. Não há "desfazer" no app.
    const ok = confirm(
      `EXCLUIR "${participant.nome}" deste evento?\n\n`
      + '• Apaga o cadastro, o credenciamento e o histórico desta pessoa neste dia.\n'
      + '• NÃO dá para desfazer pelo aplicativo.\n'
      + '• Se ela chegar depois, vai ter que ser cadastrada de novo, do zero.\n\n'
      + 'Se a intenção é só desmarcar a entrada, cancele aqui e use "Credenciado" na ficha dela.'
    );
    if (!ok) return;
    setSalvando(true);
    try {
      await api.excluir(participant.id);
      await qc.invalidateQueries({ queryKey: ['participantes', eventoId] });
      await qc.invalidateQueries({ queryKey: ['eventos'] });
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
              <div className="field">
                <label>Tipo</label>
                <select value={form.tipo} onChange={set('tipo')}>
                  <option value="comprador">Comprador</option>
                  <option value="convidado">Convidado</option>
                  <option value="comum">Comum</option>
                  <option value="socio">Sócio</option>
                  <option value="diamante">Diamante</option>
                </select>
              </div>
              <div className="field"><label>Convidado por</label><input value={form.convidadoPor || ''} onChange={set('convidadoPor')} placeholder="Nome de quem convidou" /></div>
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
              <div className="field"><label>Documento (CPF/CNPJ)</label><input value={form.documento || ''} onChange={set('documento')} /></div>
              <div className="field">
                <label>No grupo</label>
                <select value={form.grupo || ''} onChange={set('grupo')}>
                  <option value=""></option><option value="Sim">Sim</option><option value="Não">Não</option>
                </select>
              </div>
            </div>
            <div className="field-row">
              <div className="field"><label>Cidade</label><input value={form.cidade || ''} onChange={set('cidade')} /></div>
              <div className="field"><label>Estado (UF)</label><input value={form.estado || ''} onChange={set('estado')} placeholder="Ex: RS" /></div>
            </div>
            <div className="field-row">
              <div className="field"><label>Instrução</label><input value={form.instrucao} onChange={set('instrucao')} placeholder="THB, AURUM, PLATINA…" /></div>
              <div className="field"><label>Nível</label><input value={form.nivel || ''} onChange={set('nivel')} placeholder="Ex: NÍVEL OURO" /></div>
            </div>
            <div className="field"><label>Grupo (Diamante / categoria)</label><input value={form.grupoDiamante || ''} onChange={set('grupoDiamante')} placeholder="Ex: Diamante Vermelho, Sócio…" /></div>
            <div className="field">
              <label>Foto do participante</label>
              <div className="photo-preview-wrap">
                <div className="photo-preview">{foto ? <img src={foto} alt="Prévia" /> : 'Sem foto'}</div>
                <div className="photo-actions">
                  <label className="btn">Selecionar foto<input type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickFile} /></label>
                  <button type="button" className="btn ghost danger" onClick={() => setFoto('')}>Remover foto</button>
                </div>
              </div>
            </div>
            <div className="field"><label>Observações</label><textarea value={form.observacoes} onChange={set('observacoes')} /></div>

            <div className="rep-box">
              <label className="rep-check">
                <input type="checkbox" checked={temRep} onChange={(e) => setTemRep(e.target.checked)} />
                <span><b>Tem representante?</b> Quem participa e recebe o e-mail no lugar do comprador.</span>
              </label>
              {temRep && (
                <>
                  <div className="field-row">
                    <div className="field"><label>Nome do representante</label><input value={rep.nome} onChange={setR('nome')} placeholder="Nome de quem vai no lugar" /></div>
                    <div className="field"><label>Documento (CPF/CNPJ)</label><input value={rep.documento || ''} onChange={setR('documento')} /></div>
                  </div>
                  <div className="field-row">
                    <div className="field"><label>E-mail do representante</label><input type="email" value={rep.email} onChange={setR('email')} placeholder="E-mail que receberá o QR" /></div>
                    <div className="field"><label>Telefone do representante</label><input value={rep.telefone} onChange={setR('telefone')} /></div>
                  </div>
                  <p className="rep-hint">Na exportação, o e-mail de envio deste registro passa a ser o do representante.</p>
                </>
              )}
            </div>
          </div>
          <div className="modal-foot">
            {!isNew && (
              <button type="button" className="btn danger ghost" style={{ marginRight: 'auto' }} onClick={excluir} disabled={salvando}>Excluir</button>
            )}
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn primary" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
