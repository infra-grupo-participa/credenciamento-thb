import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { IconClose } from '../icons.jsx';

// Leitor de QR pela câmera. onDetected(id) -> Promise<{ok, msg}>.
export default function ScannerModal({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const rafRef = useRef(0);
  const last = useRef({ id: null, t: 0 });
  const busy = useRef(false);
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('Aponte a câmera para o QR do crachá');
  const [tone, setTone] = useState('');

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
          const now = Date.now();
          if (id !== last.current.id || now - last.current.t > 2500) {
            last.current = { id, t: now };
            handle(id);
          }
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    }
    async function handle(id) {
      busy.current = true;
      setMsg('Lendo…'); setTone('');
      try {
        const r = await onDetected(id);
        setMsg(r?.msg || ''); setTone(r?.ok ? 'ok' : 'err');
      } catch {
        setMsg('Erro ao processar'); setTone('err');
      }
      setTimeout(() => { busy.current = false; }, 1200);
    }
    return () => { cancelAnimationFrame(rafRef.current); if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, [onDetected]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 460 }}>
        <div className="modal-head">
          <h3>Ler QR do crachá</h3>
          <button className="icon-btn" onClick={onClose} title="Fechar"><IconClose /></button>
        </div>
        <div className="modal-body">
          {erro ? <div className="photo-empty">{erro}</div> : (
            <div className="scan-wrap">
              <video ref={videoRef} autoPlay playsInline muted className="scan-video" />
              <div className="scan-frame" />
            </div>
          )}
          <div className={`scan-msg ${tone}`}>{msg}</div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn primary" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
