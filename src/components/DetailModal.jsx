import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { tipoLabel, tipoCls } from '../tipos.js';
import { IconClose } from '../icons.jsx';

// Campos já exibidos de forma estruturada (não repetir em "Outras informações").
const JA_MOSTRADOS = new Set([
  'Nome', 'Nome completo', 'Email', 'E-mail', 'Telefone', 'Telefone (WhatsApp)', 'DDD',
  'Documento', 'Cidade', 'Estado', 'Turma', 'Profissão', 'Instrução', 'Nome do crachá',
]);

function Linha({ rotulo, valor }) {
  if (valor == null || String(valor).trim() === '') return null;
  return (
    <div className="kv"><span className="kv-k">{rotulo}</span><span className="kv-v">{String(valor)}</span></div>
  );
}

export default function DetailModal({ participantId, onClose, onEdit }) {
  const [p, setP] = useState(null);
  const [erro, setErro] = useState(false);
  const [foto, setFoto] = useState(null);

  useEffect(() => {
    setP(null); setErro(false); setFoto(null);
    api.detalhe(participantId)
      .then((d) => {
        setP(d);
        if (d.temFoto) api.getFoto(participantId).then((r) => setFoto(r.foto || '')).catch(() => {});
      })
      .catch(() => setErro(true));
  }, [participantId]);

  const tel = p && (p.telefone || '').replace(/\D/g, '');
  const extra = p && p.dados_extra && typeof p.dados_extra === 'object' ? p.dados_extra : null;

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 600 }}>
        <div className="modal-head">
          <h3>{p ? p.nome : 'Detalhes'}</h3>
          <button className="icon-btn" onClick={onClose} title="Fechar"><IconClose /></button>
        </div>
        <div className="modal-body">
          {erro && <div className="photo-empty">Não foi possível carregar os detalhes.</div>}
          {!erro && !p && <div className="center-screen" style={{ minHeight: 120 }}><div className="spinner" /></div>}
          {p && (
            <>
              <div className="detail-top">
                {foto ? <img className="detail-foto" src={foto} alt={p.nome} /> : null}
                <div>
                  <div className="detail-badges">
                    <span className={`tbadge tbadge-${tipoCls(p.tipo)}`}>{tipoLabel(p.tipo)}</span>
                    {p.grupoDiamante && <span className="tbadge tbadge-diamante">{p.grupoDiamante}</span>}
                    {p.credenciado
                      ? <span className="tbadge tbadge-ok">Credenciado</span>
                      : <span className="tbadge">Pendente</span>}
                  </div>
                  {p.nomeCracha && <div className="detail-sub">Crachá: {p.nomeCracha}</div>}
                </div>
              </div>

              {p.convidadoPor && (
                <div className="detail-invite">
                  <strong>Convidado(a) por:</strong> {p.convidadoPor}
                </div>
              )}

              <div className="detail-section">Contato</div>
              <Linha rotulo="E-mail" valor={p.email} />
              {p.telefone && (
                <div className="kv"><span className="kv-k">Telefone</span>
                  <span className="kv-v"><a href={`https://wa.me/${tel}`} target="_blank" rel="noopener noreferrer">{p.telefone}</a></span></div>
              )}
              <Linha rotulo="Documento" valor={p.documento} />
              <Linha rotulo="Cidade/UF" valor={[p.cidade, p.estado].filter(Boolean).join(' / ')} />

              <div className="detail-section">Perfil / Evento</div>
              <Linha rotulo="Turma" valor={p.turma} />
              <Linha rotulo="Instrução" valor={p.instrucao} />
              <Linha rotulo="Nível" valor={p.nivel} />
              <Linha rotulo="Faturamento" valor={p.faturamento} />
              <Linha rotulo="Profissão" valor={p.profissao} />
              <Linha rotulo="Tamanho da camisa" valor={p.tamanhoCamisa} />
              <Linha rotulo="Data de credenciamento" valor={p.dataCredenciamento ? new Date(p.dataCredenciamento).toLocaleString('pt-BR') : ''} />

              {p.observacoes && (<><div className="detail-section">Observações</div><div className="kv-v">{p.observacoes}</div></>)}

              {extra && (
                <>
                  <div className="detail-section">Outras informações</div>
                  {Object.entries(extra)
                    .filter(([k, v]) => !JA_MOSTRADOS.has(k) && v != null && String(v).trim() !== '' && String(v).trim() !== '-')
                    .map(([k, v]) => <Linha key={k} rotulo={k} valor={v} />)}
                </>
              )}
            </>
          )}
        </div>
        <div className="modal-foot">
          {p && onEdit && <button type="button" className="btn" style={{ marginRight: 'auto' }} onClick={() => onEdit(p)}>Editar</button>}
          <button type="button" className="btn primary" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
