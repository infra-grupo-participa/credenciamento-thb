const fmtData = (d) => {
  if (!d) return '';
  const [, m, dia] = String(d).split('-');
  return dia && m ? `${dia}/${m}` : '';
};

// Seletor de evento/dia — segmentado, linha única, com data e contagem compacta.
export default function EventBar({ eventos, eventoId, onSelect }) {
  const ativos = eventos.filter((e) => !e.arquivado).sort((a, b) => a.ordem - b.ordem);
  if (ativos.length <= 1 && !ativos.some((e) => e.id === eventoId)) return null;

  return (
    <div className="eventbar">
      <span className="eventbar-label">Evento</span>
      <div className="eventbar-seg" role="tablist">
        {ativos.map((e) => {
          const ativo = e.id === eventoId;
          const data = fmtData(e.data);
          return (
            <button
              key={e.id}
              role="tab"
              aria-selected={ativo}
              className={`evt-seg ${ativo ? 'active' : ''}`}
              onClick={() => onSelect(e.id)}
              title={`${e.nome}${data ? ` · ${data}` : ''} — ${e.credenciados}/${e.total} credenciados`}
            >
              <span className="evt-seg-main">
                <span className="evt-seg-nome">{e.nome}</span>
                {data && <span className="evt-seg-data">{data}</span>}
              </span>
              <span className="evt-seg-count">{e.credenciados}/{e.total}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
