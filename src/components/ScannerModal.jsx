import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { tipoLabel, tipoCls } from '../tipos.js';
import { IconClose } from '../icons.jsx';

const initials = (n) => {
  if (!n) return '?';
  const p = n.trim().split(/\s+/);
  return ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
};
const STATUS = {
  ok: { cls: 'ok', txt: 'Credenciado ✓' },
  duplicado: { cls: 'dup', txt: 'Já estava credenciado' },
  erro: { cls: 'err', txt: 'QR não reconhecido' },
};

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Scanner em modo quiosque: leitura contínua de QR + busca manual rápida (nome/CPF).
export default function ScannerModal({ onDetected, onManual, lista = [], onClose, eventoNome }) {
  const videoRef = useRef(null);
  const rafRef = useRef(0);
  const last = useRef(null);
  const busy = useRef(false);
  const buscaRef = useRef(null);
  const [erro, setErro] = useState('');
  const [res, setRes] = useState(null);
  const [q, setQ] = useState('');
  // Mantém o callback mais recente sem re-rodar o efeito da câmera (evita o flicker).
  const cbRef = useRef(onDetected);
  useEffect(() => { cbRef.current = onDetected; }, [onDetected]);

  // QR não reconhecido -> foca a busca manual para agilizar.
  useEffect(() => { if (res && res.naoReconhecido && buscaRef.current) buscaRef.current.focus(); }, [res]);

  const qq = q.trim();
  const qd = qq.replace(/\D/g, '');
  const matches = qq.length < 2 ? [] : (lista || []).filter((p) => {
    if (qd && (String(p.documento || '').replace(/\D/g, '').includes(qd) || String(p.telefone || '').replace(/\D/g, '').includes(qd))) return true;
    return norm(p.nome).includes(norm(qq)) || norm(p.email).includes(norm(qq));
  }).slice(0, 8);

  async function credManual(p) {
    if (busy.current || !onManual) return;
    busy.current = true;
    last.current = p.pessoa_token || p.id; // evita a câmera re-processar logo em seguida
    try { setRes(await onManual(p)); } catch { setRes({ status: 'erro', nome: 'Erro ao credenciar' }); }
    setQ('');
    setTimeout(() => { busy.current = false; }, 1000);
  }

  useEffect(() => {
    let stream;
    const canvas = document.createElement('canvas');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => { stream = s; const v = videoRef.current; if (v) { v.srcObject = s; v.play().catch(() => {}); } loop(); })
      .catch(() => setErro('Não foi possível acessar a câmera (permita o acesso).'));

    function loop() {
      const v = videoRef.current;
      if (v && v.readyState === v.HAVE_ENOUGH_DATA && !busy.current) {
        canvas.width = v.videoWidth; canvas.height = v.videoHeight;
        const cx = canvas.getContext('2d', { willReadFrequently: true });
        cx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const img = cx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height);
        if (code && code.data) {
          const id = code.data.trim();
          if (id && id !== last.current) { last.current = id; handle(id); }
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    }
    async function handle(id) {
      busy.current = true;
      try { setRes(await cbRef.current(id)); } catch { setRes({ status: 'erro', nome: 'Erro ao processar' }); }
      setTimeout(() => { busy.current = false; }, 1000);
    }
    return () => { cancelAnimationFrame(rafRef.current); if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, []);

  const st = res && (STATUS[res.status] || STATUS.erro);

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg scanner-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>Credenciando: {eventoNome || '—'}</h3>
          <button className="icon-btn" onClick={onClose} title="Fechar"><IconClose /></button>
        </div>
        <div className="modal-body">
          {erro ? <div className="photo-empty">{erro}</div> : (
            <div className="scan-grid">
              <div className="scan-wrap">
                <video ref={videoRef} autoPlay playsInline muted className="scan-video" />
                <div className="scan-frame" />
              </div>
              <div className={`scan-result ${res ? st.cls : ''}`}>
                {!res && <div className="scan-hint">Aponte a câmera para o QR do crachá/celular.</div>}
                {res && (
                  <>
                    {res.foto
                      ? <img className="scan-foto" src={res.foto} alt={res.nome} />
                      : <div className={`scan-foto scan-foto-ph avatar-${res.tipo ? tipoCls(res.tipo) : 'comum'}`}>{res.status === 'erro' ? '!' : initials(res.nome)}</div>}
                    <div className="scan-nome">{res.nome}</div>
                    {res.tipo && <span className={`tbadge tbadge-${tipoCls(res.tipo)}`}>{tipoLabel(res.tipo)}{res.turma ? ` · ${res.turma}` : ''}</span>}
                    {(res.camisa || res.grupo) && (
                      <div className="scan-extras">
                        {res.camisa && <span className="scan-chip">Camisa <b>{res.camisa}</b></span>}
                        {res.grupo && <span className="scan-chip">No grupo: <b>{res.grupo}</b></span>}
                      </div>
                    )}
                    <div className={`scan-status ${st.cls}`}>{st.txt}</div>
                    {res.sub && <div className="scan-sub">{res.sub}</div>}
                  </>
                )}
              </div>
            </div>
          )}
          <div className="scan-manual">
            <input ref={buscaRef} className="input scan-manual-input" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Não leu o QR? Buscar por nome ou CPF…" autoComplete="off" />
            {matches.length > 0 && (
              <div className="scan-manual-list">
                {matches.map((p) => (
                  <button key={p.id} type="button" className="scan-manual-item" onClick={() => credManual(p)}>
                    <span className="smi-nome">{p.nome}</span>
                    <span className="smi-meta">
                      <span className={`tbadge tbadge-${tipoCls(p.tipo)}`}>{tipoLabel(p.tipo)}</span>
                      {p.credenciado && <span className="smi-cred">já ✓</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {qq.length >= 2 && matches.length === 0 && <div className="scan-manual-empty">Ninguém encontrado nesta lista.</div>}
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn primary" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
