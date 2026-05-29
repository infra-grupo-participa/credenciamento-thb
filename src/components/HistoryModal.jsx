import { IconClose } from '../icons.jsx';

// Lista de eventos arquivados (histórico). Clicar abre o evento em modo leitura.
export default function HistoryModal({ eventos, onClose, onOpen }) {
  const arquivados = eventos.filter((e) => e.arquivado).sort((a, b) => a.ordem - b.ordem);
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 520 }}>
        <div className="modal-head">
          <h3>Histórico de eventos</h3>
          <button className="icon-btn" onClick={onClose} title="Fechar"><IconClose /></button>
        </div>
        <div className="modal-body">
          {arquivados.length === 0 && <div className="photo-empty">Nenhum evento arquivado.</div>}
          {arquivados.map((e) => {
            const pct = e.total ? Math.round((e.credenciados / e.total) * 100) : 0;
            return (
              <button key={e.id} className="hist-item" onClick={() => onOpen(e.id)}>
                <div>
                  <div className="hist-nome">{e.nome}</div>
                  <div className="hist-sub">{e.credenciados} de {e.total} credenciados · {pct}%</div>
                </div>
                <span className="hist-ver">Ver →</span>
              </button>
            );
          })}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn primary" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
