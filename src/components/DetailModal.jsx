import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api.js';
import { tipoLabel, tipoCls } from '../tipos.js';
import { nivelLabel, ingressoLabel, ehPossivelComprador } from '../perfil.js';
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

export default function DetailModal({ participantId, eventos = [], readOnly, onClose, onEdit, onCredenciar, onMarcarComprador, onOpenByName }) {
  const toast = useToast();
  const [p, setP] = useState(null);
  const [comprador, setComprador] = useState(false); // selo "possível comprador" (otimista)
  const [erro, setErro] = useState(false);
  const [foto, setFoto] = useState(null);
  const [aba, setAba] = useState('resumo');
  // Abas de topo do card: Perfil (ficha, como já era) · Pesquisa (ETHB) · NPS (D1/D2/D3).
  const [abaTop, setAbaTop] = useState('perfil');
  const [hist, setHist] = useState([]);
  // 'carregando' | 'ok' | 'erro' — "vazio" e "não consegui buscar" NÃO podem parecer
  // a mesma coisa: o operador concluiria que a pessoa nunca veio.
  const [histEstado, setHistEstado] = useState('carregando');
  const [cam, setCam] = useState(false);
  const [salvandoCred, setSalvandoCred] = useState(false);
  const [qr, setQr] = useState('');
  const fileRef = useRef(null);

  function carregarHistorico(id) {
    setHistEstado('carregando');
    api.historico(id)
      .then((r) => { setHist(r.historico || []); setHistEstado('ok'); })
      .catch(() => { setHist([]); setHistEstado('erro'); });
  }

  useEffect(() => {
    setP(null); setErro(false); setFoto(null); setHist([]); setAba('resumo'); setAbaTop('perfil'); setQr('');
    api.detalhe(participantId).then((d) => {
      setP(d);
      setComprador(ehPossivelComprador(d));
      QRCode.toDataURL(String(d.pessoa_token || d.id), { margin: 1, width: 240 }).then(setQr).catch(() => setQr(''));
      if (d.temFoto) api.getFoto(participantId).then((r) => setFoto(r.foto || '')).catch(() => {});
    }).catch(() => setErro(true));
    carregarHistorico(participantId);
  }, [participantId]);

  const tel = p && (p.telefone || '').replace(/\D/g, '');
  const extra = p && p.dados_extra && typeof p.dados_extra === 'object' ? p.dados_extra : null;
  const nomeEvento = (id) => (eventos.find((e) => e.id === id) || {}).nome || id;

  // Respostas da pesquisa e do NPS (D1/D2/D3), quando existirem. `respostas` pode
  // vir vazio — as duas abas tratam isso com um estado "ainda não respondeu".
  const respostas = p && Array.isArray(p.respostas) ? p.respostas : [];
  const pesquisa = respostas.find((r) => r && r.tipo === 'pesquisa') || null;
  const npsDias = respostas
    .filter((r) => r && /^nps_d\d+$/.test(r.tipo))
    .sort((a, b) => a.tipo.localeCompare(b.tipo, 'pt-BR', { numeric: true }));
  const sinal = p && p.sinal && typeof p.sinal === 'object' ? p.sinal : null;

  async function toggleCred() {
    if (!p || !onCredenciar) return;
    const novo = !p.credenciado;
    setSalvandoCred(true);
    try { await onCredenciar(p.id, novo, p.nome); setP({ ...p, credenciado: novo }); }
    catch { /* toast no App */ }
    finally { setSalvandoCred(false); }
  }

  async function toggleComprador() {
    if (!p || !onMarcarComprador) return;
    const novo = !comprador;
    setComprador(novo); // otimista
    try { await onMarcarComprador(p.id, novo, p.nome); }
    catch { setComprador(!novo); }
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


  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{p ? p.nome : 'Detalhes'}</h3>
          <button className="icon-btn" onClick={onClose} title="Fechar"><IconClose /></button>
        </div>

        <div className="modal-body">
          {erro && <div className="photo-empty">Não foi possível carregar os detalhes.</div>}
          {!erro && !p && <div className="center-screen" style={{ minHeight: 140 }}><div className="spinner" /></div>}
          {p && (
            <>

              {/* ===== Cabeçalho: foto + identidade + status ===== */}
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
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className={`detail-status-pill ${p.credenciado ? 'ok' : 'pend'}`}>
                    {p.credenciado ? <><IconCheck /> Credenciado</> : <><IconSquare /> Pendente</>}
                  </div>
                  <div className="detail-badges">
                    <span className="detail-nivel">{nivelLabel(p)}</span>
                    {ingressoLabel(p) && <span className={`detail-ingresso ing-${ingressoLabel(p).toLowerCase()}`}>{ingressoLabel(p)}</span>}
                    <span className={`tbadge tbadge-${tipoCls(p.tipo)}`}>{tipoLabel(p.tipo)}</span>
                  </div>
                  {p.nomeCracha && <div className="detail-sub">Crachá: {p.nomeCracha}</div>}
                </div>
              </div>

              {cam && <CameraCapture onShot={salvarFoto} onCancel={() => setCam(false)} />}

              {/* ===== Ações principais ===== */}
              {!readOnly && (onCredenciar || onMarcarComprador) && (
                <div className="detail-actions-row">
                  {onCredenciar && (
                    <button className={`btn ${p.credenciado ? '' : 'primary'} detail-act`} onClick={toggleCred} disabled={salvandoCred}>
                      {p.credenciado ? <><IconSquare /> Desfazer credenciamento</> : <><IconCheck /> Credenciar agora</>}
                    </button>
                  )}
                  {onMarcarComprador && (
                    <button className={`btn ${comprador ? 'comprador-on' : 'ghost'} detail-act`} onClick={toggleComprador}>
                      {comprador ? '★ É possível comprador' : '☆ Marcar possível comprador'}
                    </button>
                  )}
                </div>
              )}

              {/* ===== Abas de topo: Perfil (ficha) · Pesquisa (ETHB) · NPS ===== */}
              <div className="tabs tabs-top">
                <button className={abaTop === 'perfil' ? 'active' : ''} onClick={() => setAbaTop('perfil')}>Perfil</button>
                <button className={abaTop === 'pesquisa' ? 'active' : ''} onClick={() => setAbaTop('pesquisa')}>Pesquisa</button>
                <button className={abaTop === 'nps' ? 'active' : ''} onClick={() => setAbaTop('nps')}>NPS{npsDias.length ? ` (${npsDias.length})` : ''}</button>
              </div>

              {abaTop === 'perfil' && (<>

              {/* ===== Qualificação: foco do ETHB é o possível comprador do Aurum ===== */}
              {p.tipo === 'comprador' && (
                <section className="detail-sec">
                  <div className="detail-sec-title">Qualificação</div>
                  <div className="detail-qual-grid">
                    <div className={`detail-qual ${comprador ? 'sim' : 'nao'}`}>
                      <span className="dq-k">Possível comprador (Aurum)</span>
                      <span className="dq-v">{comprador ? 'SIM' : 'não'}</span>
                    </div>
                  </div>
                </section>
              )}

              {/* ===== Sinais comerciais (pesquisa ETHB) — bater o olho e ver se é forte
                   candidato a comprar o Aurum. Fonte diferente do selo manual acima
                   (aquele é marcado pela equipe; este vem das respostas da pessoa). ===== */}
              {sinal && (
                <section className="detail-sec">
                  <div className="detail-sec-title">Sinais comerciais (pesquisa)</div>
                  <div className="detail-badges" style={{ marginBottom: 10 }}>
                    {sinal.ingresso && <span className={`detail-ingresso ing-${String(sinal.ingresso).toLowerCase()}`}>{sinal.ingresso}</span>}
                    {sinal.origem && <span className="badge">Origem: {sinal.origem}</span>}
                    {sinal.turma && <span className="badge turma">{sinal.turma}</span>}
                    {sinal.grupo_diamante && <span className="badge">{sinal.grupo_diamante}</span>}
                    {sinal.socio_vai_sozinho && <span className="badge">Sócio vai sozinho: {sinal.socio_vai_sozinho}</span>}
                  </div>
                  <div className="detail-sinais">
                    <SinalPill label="Possível comprador" v={sinal.possivel_comprador} />
                    <SinalPill label="Possível Aurum" v={sinal.possivel_aurum} />
                    <SinalPill label="Renovação Aurum" v={sinal.possivel_renov_aurum} />
                    <SinalPill label="Possível HM" v={sinal.possivel_hm} />
                    <SinalPill label="Renovação HM" v={sinal.possivel_renov_hm} />
                  </div>
                </section>
              )}

              {/* ===== Dados do participante ===== */}
              <section className="detail-sec">
                <div className="detail-sec-title">Dados do participante</div>
                <div className="detail-info-grid">
                  {p.telefone && (
                    <div className="di"><span className="di-k">WhatsApp</span>
                      <a className="di-v" href={`https://wa.me/${tel}`} target="_blank" rel="noopener noreferrer">{p.telefone}</a></div>
                  )}
                  <Di k="E-mail" v={p.email} />
                  <Di k="Cidade / UF" v={[p.cidade, p.estado].filter(Boolean).join(' / ')} />
                  <Di k="Turma" v={p.turma} />
                  <Di k="Instrução" v={p.instrucao} />
                  <Di k="Profissão" v={p.profissao} />
                  <Di k="Faturamento" v={p.faturamento} />
                  <Di k="Camisa" v={p.tamanhoCamisa} />
                  <Di k="Documento" v={p.documento} />
                  <Di k="Nível" v={p.nivel} />
                </div>
                {p.convidadoPor && (
                  <div className="detail-invite-inline">
                    <span className="di-k">Convidado por</span>{' '}
                    {onOpenByName
                      ? <button className="link-btn" onClick={() => onOpenByName(p.convidadoPor)}>{p.convidadoPor}</button>
                      : <b>{p.convidadoPor}</b>}
                  </div>
                )}
                {p.observacoes && <div className="detail-obs"><span className="di-k">Observações</span> {p.observacoes}</div>}
              </section>

              {/* ===== Representante (se houver) ===== */}
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

              {/* ===== Detalhes extras + QR (recolhidos em abas) ===== */}
              <div className="tabs">
                <button className={aba === 'resumo' ? 'active' : ''} onClick={() => setAba('resumo')}>QR / Crachá</button>
                <button className={aba === 'tudo' ? 'active' : ''} onClick={() => setAba('tudo')}>Todos os campos</button>
                <button className={aba === 'hist' ? 'active' : ''} onClick={() => setAba('hist')}>Histórico {hist.length > 1 ? `(${hist.length})` : ''}</button>
              </div>

              {aba === 'resumo' && qr && (
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
                  {histEstado === 'carregando' && <div className="photo-empty">Buscando o histórico…</div>}
                  {histEstado === 'erro' && (
                    <div className="estado-erro" role="alert">
                      <div className="ee-titulo">Não deu para buscar o histórico</div>
                      <div className="ee-sub">Isso <strong>não</strong> quer dizer que a pessoa nunca veio — a busca falhou. Tente de novo.</div>
                      <button type="button" className="btn primary" onClick={() => carregarHistorico(participantId)}>
                        Tentar de novo
                      </button>
                    </div>
                  )}
                  {histEstado === 'ok' && hist.length === 0 && <div className="photo-empty">Sem histórico em outros eventos.</div>}
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

              </>)}

              {/* ===== Pesquisa ETHB: perguntas (frases longas) em cima, resposta discursiva
                   destacada embaixo — é a parte que precisa de mais espaço para ler. ===== */}
              {abaTop === 'pesquisa' && (
                pesquisa ? (
                  <div className="kvs">
                    <div className="pesquisa-meta">
                      Respondida{pesquisa.respondido_em ? ` em ${new Date(pesquisa.respondido_em).toLocaleString('pt-BR')}` : ''}
                    </div>
                    {Object.entries(pesquisa.respostas || {}).map(([pergunta, resp]) => (
                      <div className="pq-item" key={pergunta}>
                        <div className="pq-pergunta">{pergunta}</div>
                        <div className="pq-resposta">{Array.isArray(resp) ? resp.join(', ') : String(resp ?? '—')}</div>
                      </div>
                    ))}
                    {Object.keys(pesquisa.respostas || {}).length === 0 && (
                      <div className="photo-empty">Respondeu, mas não há perguntas registradas.</div>
                    )}
                  </div>
                ) : (
                  <div className="photo-empty">Ainda não respondeu à pesquisa do ETHB.</div>
                )
              )}

              {/* ===== NPS: um card por dia que existir (D1/D2/D3) — nota em destaque
                   no topo do card, textos abaixo. Precisa aguentar 1, 2 ou 3 dias. ===== */}
              {abaTop === 'nps' && (
                npsDias.length > 0 ? (
                  <div className="nps-grid">
                    {npsDias.map((d) => (
                      <div className="nps-dia" key={d.tipo}>
                        <div className="nps-dia-head">
                          <span className="nps-dia-label">{`Dia ${(d.tipo.match(/\d+/) || ['?'])[0]}`}</span>
                          <span className={`nps-nota ${notaFaixa(d.nota)}`} title="Nota do NPS (0 a 10)">
                            {d.nota == null ? '—' : d.nota}
                          </span>
                        </div>
                        {Object.entries(d.respostas || {}).map(([pergunta, resp]) => (
                          <div className="pq-item" key={pergunta}>
                            <div className="pq-pergunta">{pergunta}</div>
                            <div className="pq-resposta">{Array.isArray(resp) ? resp.join(', ') : String(resp ?? '—')}</div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="photo-empty">Ainda não respondeu ao NPS em nenhum dia.</div>
                )
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

// Pílula SIM/não/— de um sinal comercial (possível comprador, Aurum, HM…).
// `v` pode vir null/undefined quando a pesquisa não perguntou aquilo para esta pessoa.
function SinalPill({ label, v }) {
  if (v == null) return <span className="detail-sinal" title="Sem dado para este sinal"><b>—</b> {label}</span>;
  return <span className={`detail-sinal ${v ? 'sim' : 'nao'}`}><b>{v ? 'SIM' : 'não'}</b> {label}</span>;
}

// Faixa de cor da nota do NPS (0-6 detrator, 7-8 neutro, 9-10 promotor) — padrão do mercado.
function notaFaixa(n) {
  if (n == null) return '';
  if (n <= 6) return 'baixa';
  if (n <= 8) return 'media';
  return 'alta';
}

// Item do grid de "Dados do participante": rótulo em cima, valor embaixo.
// Não renderiza se vazio (o grid se reorganiza sozinho sem buracos).
function Di({ k, v }) {
  if (v == null || String(v).trim() === '') return null;
  return <div className="di"><span className="di-k">{k}</span><span className="di-v">{String(v)}</span></div>;
}
