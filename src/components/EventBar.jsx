import { IconReset } from '../icons.jsx';

// Barra de seleção de evento/dia + acesso ao histórico.
export default function EventBar({ eventos, eventoId, onSelect, onOpenHistory }) {
  const ativos = eventos.filter((e) => !e.arquivado).sort((a, b) => a.ordem - b.ordem);
  const temHistorico = eventos.some((e) => e.arquivado);

  return (
    <div className="eventbar">
      <div className="eventbar-tabs">
        {ativos.map((e) => {
          const ativo = e.id === eventoId;
          return (
            <button key={e.id} className={`evt-tab ${ativo ? 'active' : ''}`} onClick={() => onSelect(e.id)}>
              <span className="evt-nome">{e.nome}</span>
              <span className="evt-count">{e.credenciados}/{e.total}</span>
            </button>
          );
        })}
      </div>
      {temHistorico && (
        <button className="btn ghost" onClick={onOpenHistory} title="Eventos passados">
          <IconReset /> Histórico
        </button>
      )}
    </div>
  );
}
