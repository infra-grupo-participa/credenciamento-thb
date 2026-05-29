import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { IconClose } from '../icons.jsx';

// Mostra a foto do participante, carregada sob demanda (não vem na listagem).
export default function PhotoModal({ participant, onClose }) {
  const [foto, setFoto] = useState(null); // null = carregando
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (!participant.temFoto) { setFoto(''); return; }
    setFoto(null);
    setErro(false);
    api.getFoto(participant.id)
      .then((d) => setFoto(d.foto || ''))
      .catch(() => setErro(true));
  }, [participant]);

  return (
    <div className="modal-overlay photo-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{participant.nome || 'Foto do participante'}</h3>
          <button className="icon-btn" onClick={onClose} title="Fechar"><IconClose /></button>
        </div>
        <div className="modal-body">
          <div className="photo-view">
            {erro && <div className="photo-empty">Não foi possível carregar a foto.</div>}
            {!erro && foto === null && <div className="spinner" />}
            {!erro && foto === '' && <div className="photo-empty">Esse participante ainda não tem foto cadastrada.</div>}
            {!erro && foto && <img src={foto} alt={`Foto de ${participant.nome || 'participante'}`} />}
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
