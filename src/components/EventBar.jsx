import { IconReset } from '../icons.jsx';

const fmtData = (d) => {
  if (!d) return '';
  const [y, m, dia] = String(d).split('-');
  return dia && m ? `${dia}/${m}` : '';
};

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
              <span className="evt-nome">{e.nome}{e.data ? ` · ${fmtData(e.data)}` : ''}</span>
              <span className="evt-count">{e.credenciados}/{e.total} credenciados</span>
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
