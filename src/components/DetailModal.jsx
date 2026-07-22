import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api.js';
import { tipoLabel, tipoCls } from '../tipos.js';
import { useToast } from './Toasts.jsx';
import { IconClose, IconCheck, IconSquare, IconEdit } from '../icons.jsx';

// Catálogo de campos exibíveis/fixáveis (rótulo + como formatar).
const CAMPOS = [
  { k: 'turma', label: 'Turma' },
  { k: 'instrucao', label: 'Instrução' },
  { k: 'tipo', label: 'Tipo', fmt: (v) => tipoLabel(v) },
  { k: 'grupoDiamante', label: 'Grupo Diamante' },
  { k: 'tamanhoCamisa', label: 'Camisa' },
  { k: 'nivel', label: 'Nível' },
  { k: 'faturamento', label: 'Faturamento' },
  { k: 'profissao', label: 'Profissão' },
  { k: 'cidade', label: 'Cidade' },
  { k: 'estado', label: 'Estado' },
  { k: 'documento', label: 'Documento' },
  { k: 'email', label: 'E-mail' },
  { k: 'telefone', label: 'Telefone' },
  { k: 'convidadoPor', label: 'Convidado por' },
];
const JA_MOSTRADOS = new Set(['Nome', 'Nome completo', 'Email', 'E-mail', 'Telefone', 'Telefone (WhatsApp)',
  'DDD', 'Documento', 'Cidade', 'Estado', 'Turma', 'Profissão', 'Instrução', 'Nome do crachá']);
const val = (p, k) => { const c = CAMPOS.find((x) => x.k === k); const v = p[k]; return v == null || v === '' ? '' : (c && c.fmt ? c.fmt(v) : String(v)); };

function CameraCapture({ onShot, onCancel }) {
  const videoRef = useRef(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    let stream;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      .then((s) => { stream = s; if (videoRef.current) videoRef.current.srcObject = s; })
      .catch(() => setErro('Não foi possível acessar a câmera.'));
    return () => { if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, []);
  function capturar() {
    const v = videoRef.current; if (!v) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    onShot(c.toDataURL('image/jpeg', 0.8));
  }
  return (
    <div className="cam-wrap">
      {erro ? <div className="photo-empty">{erro}</div> : <video ref={videoRef} autoPlay playsInline className="cam-video" />}
      <div className="cam-actions">
        <button type="button" className="btn" onClick={onCancel}>Cancelar</button>
        {!erro && <button type="button" className="btn primary" onClick={capturar}>Capturar</button>}
      </div>
    </div>
  );
}

export default function DetailModal({ participantId, eventos = [], readOnly, onClose, onEdit, onCredenciar, onOpenByName }) {
  const toast = useToast();
  const [p, setP] = useState(null);
  const [erro, setErro] = useState(false);
  const [foto, setFoto] = useState(null);
  const [aba, setAba] = useState('resumo');
  const [hist, setHist] = useState([]);
  const [fixos, setFixos] = useState([]);
  const [configOpen, setConfigOpen] = useState(false);
  const [cam, setCam] = useState(false);
  const [salvandoCred, setSalvandoCred] = useState(false);
  const [qr, setQr] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    setP(null); setErro(false); setFoto(null); setHist([]); setAba('resumo'); setQr('');
    api.detalhe(participantId).then((d) => {
      setP(d);
      QRCode.toDataURL(String(d.pessoa_token || d.id), { margin: 1, width: 240 }).then(setQr).catch(() => setQr(''));
      if (d.temFoto) api.getFoto(participantId).then((r) => setFoto(r.foto || '')).catch(() => {});
    }).catch(() => setErro(true));
    api.historico(participantId).then((r) => setHist(r.historico || [])).catch(() => {});
    api.getConfig('detalhe').then((r) => setFixos((r.v && r.v.fixos) || ['turma', 'instrucao', 'tamanhoCamisa', 'tipo'])).catch(() => {});
  }, [participantId]);

  const tel = p && (p.telefone || '').replace(/\D/g, '');
  const extra = p && p.dados_extra && typeof p.dados_extra === 'object' ? p.dados_extra : null;
  const nomeEvento = (id) => (eventos.find((e) => e.id === id) || {}).nome || id;

  async function toggleCred() {
    if (!p || !onCredenciar) return;
    const novo = !p.credenciado;
    setSalvandoCred(true);
    try { await onCredenciar(p.id, novo, p.nome); setP({ ...p, credenciado: novo }); }
    catch { /* toast no App */ }
    finally { setSalvandoCred(false); }
  }

  async function salvarFoto(dataUrl) {
    setFoto(dataUrl); setCam(false);
    try { await api.setFoto(p.id, dataUrl); toast('Foto atualizada', 'success'); }
    catch { toast('Erro ao salvar foto', 'danger'); }
  }
  function onPickFile(e) {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast('Selecione uma imagem', 'danger'); return; }
    const reader = new FileReader();
    reader.onload = () => salvarFoto(reader.result);
    reader.readAsDataURL(f);
  }

  function imprimirCracha() {
    const w = window.open('', '_blank', 'width=480,height=640'); if (!w) return;
    const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Crachá</title>
      <style>body{font-family:Inter,Arial,sans-serif;text-align:center;padding:28px;color:#1d1d1b}
      h1{font-size:26px;margin:8px 0} .sub{color:#777;font-size:13px} .t{display:inline-block;background:#ef7c00;color:#fff;border-radius:999px;padding:4px 14px;font-weight:700;margin-top:6px}
      img{width:240px;height:240px;margin-top:16px}</style></head><body>
      <div class="sub">Time Holding Brasil</div><h1>${esc(p.nomeCracha || p.nome)}</h1>
      ${p.turma ? `<div class="t">${esc(p.turma)}</div>` : ''}
      <div><img src="${qr}" alt="QR"/></div>
      <script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
  }

  function mensagemQR() {
    const link = `${window.location.origin}/qr/${p.pessoa_token || p.id}`;
    return `Olá ${p.nome}! 👋 Para agilizar seu credenciamento, salve seu QR de acesso: ${link} — é só mostrar na entrada. Time Holding Brasil.`;
  }
  async function copiarWhats() {
    try { await navigator.clipboard.writeText(mensagemQR()); toast('Mensagem copiada — cole no WhatsApp', 'success'); }
    catch { toast('Não consegui copiar', 'danger'); }
  }

  async function toggleFixo(k) {
    const novos = fixos.includes(k) ? fixos.filter((x) => x !== k) : [...fixos, k];
    setFixos(novos);
    try { await api.setConfig('detalhe', { fixos: novos }); } catch { /* silencioso */ }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{p ? p.nome : 'Detalhes'}</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            {!readOnly && <button className="icon-btn" onClick={() => setConfigOpen((v) => !v)} title="Configurar campos">⚙</button>}
            <button className="icon-btn" onClick={onClose} title="Fechar"><IconClose /></button>
          </div>
        </div>

        <div className="modal-body">
          {erro && <div className="photo-empty">Não foi possível carregar os detalhes.</div>}
          {!erro && !p && <div className="center-screen" style={{ minHeight: 140 }}><div className="spinner" /></div>}
          {p && (
            <>
              {configOpen && (
                <div className="cfg-panel">
                  <div className="cfg-title">Campos em destaque (vale para todos)</div>
                  <div className="cfg-chips">
                    {CAMPOS.map((c) => (
                      <button key={c.k} className={`cfg-chip ${fixos.includes(c.k) ? 'on' : ''}`} onClick={() => toggleFixo(c.k)}>{c.label}</button>
                    ))}
                  </div>
                </div>
              )}

              <div className="detail-top">
                <div className="detail-foto-box">
                  {foto ? <img className="detail-foto" src={foto} alt={p.nome} /> : <div className="detail-foto detail-foto-empty">Sem foto</div>}
                  {!readOnly && (
                    <div className="detail-foto-actions">
                      <label className="btn ghost mini">Galeria<input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickFile} /></label>
                      <button className="btn ghost mini" onClick={() => setCam(true)}>Câmera</button>
                    </div>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div className="detail-badges">
                    <span className={`tbadge tbadge-${tipoCls(p.tipo)}`}>{tipoLabel(p.tipo)}</span>
                    {p.grupoDiamante && <span className="tbadge tbadge-diamante">{p.grupoDiamante}</span>}
                    {p.credenciado ? <span className="tbadge tbadge-ok">Credenciado</span> : <span className="tbadge">Pendente</span>}
                  </div>
                  {p.nomeCracha && <div className="detail-sub">Crachá: {p.nomeCracha}</div>}
                  {!readOnly && onCredenciar && (
                    <button className={`btn ${p.credenciado ? '' : 'primary'} detail-cred`} onClick={toggleCred} disabled={salvandoCred}>
                      {p.credenciado ? <><IconSquare /> Desfazer credenciamento</> : <><IconCheck /> Credenciar agora</>}
                    </button>
                  )}
                </div>
              </div>

              {cam && <CameraCapture onShot={salvarFoto} onCancel={() => setCam(false)} />}

              {p.convidadoPor && (
                <div className="detail-invite">
                  <strong>Convidado(a) por:</strong>{' '}
                  {onOpenByName
                    ? <button className="link-btn" onClick={() => onOpenByName(p.convidadoPor)}>{p.convidadoPor}</button>
                    : p.convidadoPor}
                </div>
              )}

              {p.representante && (p.representante.nome || p.representante.email) && (
                <div className="detail-rep">
                  <div className="detail-rep-tag">Participa por representante</div>
                  <div className="detail-rep-body">
                    <div><strong>{p.representante.nome || '—'}</strong>{p.representante.documento ? ` · ${p.representante.documento}` : ''}</div>
                    {p.representante.email && <div className="detail-rep-mail">✉ {p.representante.email} <span className="detail-rep-note">(e-mail de envio)</span></div>}
                    {p.representante.telefone && <div>{p.representante.telefone}</div>}
                  </div>
                </div>
              )}

              {qr && (
                <div className="qr-row">
                  <img className="qr-img" src={qr} alt="QR do crachá" />
                  <div className="qr-info">
                    <div className="qr-hint">QR de credenciamento — envie ao participante ou use no leitor.</div>
                    <div className="qr-btns">
                      <button className="btn" onClick={copiarWhats}>Copiar msg WhatsApp</button>
                      {tel && <a className="btn ghost" href={`https://wa.me/${tel}?text=${encodeURIComponent(mensagemQR())}`} target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a>}
                      {!readOnly && <button className="btn ghost" onClick={imprimirCracha}>Imprimir crachá</button>}
                    </div>
                  </div>
                </div>
              )}

              {/* Destaques (campos fixados) */}
              {fixos.length > 0 && (
                <div className="destaques">
                  {fixos.map((k) => { const v = val(p, k); if (!v) return null; const c = CAMPOS.find((x) => x.k === k);
                    return <div key={k} className="destaque"><span className="d-k">{c ? c.label : k}</span><span className="d-v">{v}</span></div>; })}
                </div>
              )}

              <div className="tabs">
                <button className={aba === 'resumo' ? 'active' : ''} onClick={() => setAba('resumo')}>Resumo</button>
                <button className={aba === 'tudo' ? 'active' : ''} onClick={() => setAba('tudo')}>Tudo</button>
                <button className={aba === 'hist' ? 'active' : ''} onClick={() => setAba('hist')}>Histórico {hist.length > 1 ? `(${hist.length})` : ''}</button>
              </div>

              {aba === 'resumo' && (
                <div className="kvs">
                  <Kv rotulo="E-mail" valor={p.email} />
                  {p.telefone && <div className="kv"><span className="kv-k">Telefone</span><span className="kv-v"><a href={`https://wa.me/${tel}`} target="_blank" rel="noopener noreferrer">{p.telefone}</a></span></div>}
                  <Kv rotulo="Cidade/UF" valor={[p.cidade, p.estado].filter(Boolean).join(' / ')} />
                  <Kv rotulo="Turma" valor={p.turma} />
                  <Kv rotulo="Instrução" valor={p.instrucao} />
                  <Kv rotulo="Nível" valor={p.nivel} />
                  <Kv rotulo="Profissão" valor={p.profissao} />
                  <Kv rotulo="Camisa" valor={p.tamanhoCamisa} />
                  <Kv rotulo="Documento" valor={p.documento} />
                  {p.observacoes && <Kv rotulo="Observações" valor={p.observacoes} />}
                </div>
              )}

              {aba === 'tudo' && (
                <div className="kvs">
                  {CAMPOS.map((c) => <Kv key={c.k} rotulo={c.label} valor={val(p, c.k)} />)}
                  <Kv rotulo="Faturamento" valor={p.faturamento} />
                  {p.observacoes && <Kv rotulo="Observações" valor={p.observacoes} />}
                  {extra && Object.entries(extra)
                    .filter(([k, v]) => !JA_MOSTRADOS.has(k) && v != null && String(v).trim() !== '' && String(v).trim() !== '-')
                    .map(([k, v]) => <Kv key={k} rotulo={k} valor={String(v)} />)}
                </div>
              )}

              {aba === 'hist' && (
                <div className="kvs">
                  {hist.length === 0 && <div className="photo-empty">Sem histórico em outros eventos.</div>}
                  {hist.map((h) => (
                    <div key={h.id} className="kv">
                      <span className="kv-k">{nomeEvento(h.evento_id)}</span>
                      <span className="kv-v">{h.credenciado
                        ? `Credenciado${h.dataCredenciamento ? ' · ' + new Date(h.dataCredenciamento).toLocaleString('pt-BR') : ''}`
                        : 'Pendente'}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-foot">
          {p && onEdit && <button type="button" className="btn" style={{ marginRight: 'auto' }} onClick={() => onEdit(p)}><IconEdit /> Editar cadastro</button>}
          <button type="button" className="btn primary" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

function Kv({ rotulo, valor }) {
  if (valor == null || String(valor).trim() === '') return null;
  return <div className="kv"><span className="kv-k">{rotulo}</span><span className="kv-v">{String(valor)}</span></div>;
}
