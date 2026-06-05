import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { tipoLabel, tipoCls } from '../tipos.js';
import { IconClose, IconCheck } from '../icons.jsx';

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

// Tempo que o cartão de OK/duplicado fica na tela antes de voltar para "pronto".
// (Se a próxima pessoa for lida antes disso, o card troca na hora — não atrasa a fila.)
const AUTO_DISMISS_MS = 2200;
// Cooldown entre uma pessoa e a próxima. Curto para a fila andar rápido; a proteção
// contra ler o MESMO QR duas vezes vem da dedup-por-presença (GAP_MS), não daqui.
const BUSY_LOCK_MS = 550;
// Enquanto o MESMO QR é visto dentro desta janela, não reprocessa (continua na frente
// da câmera ou piscou). Some por mais que isto -> pode ser lido de novo (re-scan proposital).
const GAP_MS = 1500;
// Throttle do reconhecimento (ms) — leve para a câmera, suficiente para leitura instantânea.
const SCAN_EVERY_MS = 110;
// Reduz o frame antes do jsQR (mais rápido e mais frio em sessões longas).
const MAX_SCAN_W = 640;

// Scanner em modo quiosque: leitura CONTÍNUA de QR (um após o outro, sem reabrir)
// + busca manual rápida (nome/CPF) para quando o QR não lê.
export default function ScannerModal({ onDetected, onManual, lista = [], onClose, eventoNome }) {
  const videoRef = useRef(null);
  const rafRef = useRef(0);
  const last = useRef(null);          // { code, at } — controle de presença do QR em quadro
  const busy = useRef(false);
  const dismissRef = useRef(0);
  const buscaRef = useRef(null);
  const [erro, setErro] = useState('');
  const [res, setRes] = useState(null);
  const [pronto, setPronto] = useState(true);   // false enquanto processa uma leitura
  const [contador, setContador] = useState(0);  // credenciados nesta sessão de scanner
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

  // Mostra o resultado e agenda a volta automática para "pronto" (sucesso/duplicado).
  // Erros que pedem ação (QR não reconhecido) permanecem até a próxima leitura.
  function mostrarResultado(r) {
    setRes(r);
    if (r && r.status === 'ok') setContador((c) => c + 1);
    clearTimeout(dismissRef.current);
    if (r && (r.status === 'ok' || r.status === 'duplicado')) {
      dismissRef.current = setTimeout(() => setRes(null), AUTO_DISMISS_MS);
    }
  }

  async function credManual(p) {
    if (busy.current || !onManual) return;
    busy.current = true; setPronto(false);
    // Marca como "em quadro agora" para a câmera não reprocessar logo em seguida.
    last.current = { code: p.pessoa_token || p.id, at: (typeof performance !== 'undefined' ? performance.now() : 0) };
    try { mostrarResultado(await onManual(p)); } catch { mostrarResultado({ status: 'erro', nome: 'Erro ao credenciar' }); }
    setQ('');
    setTimeout(() => { busy.current = false; setPronto(true); buscaRef.current?.focus(); }, BUSY_LOCK_MS);
  }

  useEffect(() => {
    let stream;
    let lastScan = 0;
    const canvas = document.createElement('canvas');
    const cx = canvas.getContext('2d', { willReadFrequently: true });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => { stream = s; const v = videoRef.current; if (v) { v.srcObject = s; v.play().catch(() => {}); } loop(); })
      .catch(() => setErro('Não foi possível acessar a câmera (permita o acesso).'));

    function loop(ts) {
      rafRef.current = requestAnimationFrame(loop);
      const now = ts || (typeof performance !== 'undefined' ? performance.now() : 0);
      if (now - lastScan < SCAN_EVERY_MS) return;
      lastScan = now;

      const v = videoRef.current;
      if (!v || v.readyState !== v.HAVE_ENOUGH_DATA || busy.current) return;

      // Downscale para acelerar e manter a câmera fluida em sessões longas.
      const scale = Math.min(1, MAX_SCAN_W / (v.videoWidth || MAX_SCAN_W));
      canvas.width = Math.round((v.videoWidth || MAX_SCAN_W) * scale);
      canvas.height = Math.round((v.videoHeight || MAX_SCAN_W) * scale);
      cx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const img = cx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (!code || !code.data) return;

      const c = code.data.trim();
      if (!c) return;
      const l = last.current;
      const aindaEmQuadro = l && l.code === c && (now - l.at) < GAP_MS;
      if (aindaEmQuadro) {
        // Mesmo QR continua na frente da câmera: só atualiza o "visto agora", não reprocessa.
        last.current = { code: c, at: now };
      } else {
        last.current = { code: c, at: now };
        process(c);
      }
    }

    async function process(code) {
      busy.current = true; setPronto(false);
      try { mostrarResultado(await cbRef.current(code)); }
      catch { mostrarResultado({ status: 'erro', nome: 'Erro ao processar' }); }
      setTimeout(() => { busy.current = false; setPronto(true); }, BUSY_LOCK_MS);
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(dismissRef.current);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const st = res && (STATUS[res.status] || STATUS.erro);

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg scanner-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>Credenciando: {eventoNome || '—'}</h3>
          <div className="scan-head-right">
            {contador > 0 && <span className="scan-counter"><IconCheck /> {contador} nesta sessão</span>}
            <button className="icon-btn" onClick={onClose} title="Fechar"><IconClose /></button>
          </div>
        </div>
        <div className="modal-body">
          {erro ? <div className="photo-empty">{erro}</div> : (
            <div className="scan-grid">
              <div className="scan-wrap">
                <video ref={videoRef} autoPlay playsInline muted className="scan-video" />
                <div className={`scan-frame ${pronto ? 'pronto' : 'lendo'}`} />
                <div className={`scan-state ${pronto ? 'pronto' : 'lendo'}`}>
                  <span className="dot" />{pronto ? 'Pronto — aponte o próximo QR' : 'Lendo…'}
                </div>
              </div>
              <div className={`scan-result ${res ? st.cls : 'idle'}`}>
                {!res && (
                  <div className="scan-hint">
                    <div className="scan-hint-big">Leitura contínua ativa</div>
                    Aponte a câmera para o QR do crachá/celular.<br />
                    Pode escanear um após o outro, sem fechar esta tela.
                  </div>
                )}
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
          <button type="button" className="btn" onClick={onClose}>Encerrar leitura</button>
        </div>
      </div>
    </div>
  );
}
