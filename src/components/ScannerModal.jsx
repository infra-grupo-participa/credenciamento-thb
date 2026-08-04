import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { tipoLabel, tipoCls } from '../tipos.js';
import { IconClose, IconCheck } from '../icons.jsx';

const initials = (n) => {
  if (!n) return '?';
  const p = n.trim().split(/\s+/);
  return ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
};
// Cada estado tem ÍCONE + TEXTO + COR (nunca só a cor — WCAG 1.4.1) e usa o mesmo
// par ícone/cor em todo o app: ✓ verde = ok, ! âmbar = atenção, ✕ vermelho = erro.
const STATUS = {
  ok: { cls: 'ok', ico: '✓', txt: 'Credenciado' },
  duplicado: { cls: 'dup', ico: '!', txt: 'Já estava credenciado' },
  erro: { cls: 'err', ico: '✕', txt: 'QR não reconhecido' },
};

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// O card do último lido FICA na tela (modo painel): as informações da pessoa
// permanecem visíveis até a PRÓXIMA leitura, para a equipe analisar o perfil com
// calma (nível THB, ingresso, possível comprador, contato). Só troca quando bate
// outro QR ou quando o operador toca em "continuar lendo".
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
export default function ScannerModal({
  onDetected, onManual, onUndo, onTrocarEvento, onQuickAdd, onMarcarComprador,
  lista = [], onClose, eventoNome,
  pendentes = 0, online = true, diaErrado = false, nomeDeHoje = '', onIrParaHoje = null,
}) {
  const videoRef = useRef(null);
  const rafRef = useRef(0);
  const last = useRef(null);          // { code, at } — controle de presença do QR em quadro
  const busy = useRef(false);
  const buscaRef = useRef(null);
  const [erro, setErro] = useState('');
  const [res, setRes] = useState(null);
  const [compradorLocal, setCompradorLocal] = useState(false); // selo comprador do card atual (otimista)
  const [pronto, setPronto] = useState(true);   // false enquanto processa uma leitura
  const [contador, setContador] = useState(0);  // credenciados nesta sessão de scanner
  const [recentes, setRecentes] = useState([]); // últimos credenciados da sessão (p/ desfazer)
  const [q, setQ] = useState('');
  // Default do walk-in: no ETHB quem chega fora da lista quase sempre COMPROU em cima da
  // hora (308 compradores x 53 convidados no dia 1). "comum" deixaria a pessoa invisível
  // no filtro de Tipo da toolbar, que só oferece comprador/convidado.
  const [quickTipo, setQuickTipo] = useState('comprador');
  const [ajuda, setAjuda] = useState(false);        // painel de ajuda rápida (texto, funciona offline)
  const [tentativaCam, setTentativaCam] = useState(0); // re-tenta a câmera sem fechar o scanner
  // Mantém o callback mais recente sem re-rodar o efeito da câmera (evita o flicker).
  const cbRef = useRef(onDetected);
  useEffect(() => { cbRef.current = onDetected; }, [onDetected]);

  // Mantém a tela acesa durante a sessão de leitura (o descanso de tela no meio
  // da fila obriga a destravar o celular a cada pessoa). Reobtém ao voltar do
  // background — o navegador solta o lock quando a aba perde visibilidade.
  useEffect(() => {
    let lock = null;
    let ativo = true;
    async function pegar() {
      try {
        if (ativo && navigator.wakeLock && document.visibilityState === 'visible') {
          lock = await navigator.wakeLock.request('screen');
        }
      } catch { /* sem suporte/permissão — segue sem */ }
    }
    pegar();
    const onVis = () => { if (document.visibilityState === 'visible') pegar(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      ativo = false;
      document.removeEventListener('visibilitychange', onVis);
      try { lock && lock.release(); } catch { /* ignora */ }
    };
  }, []);

  // QR não reconhecido -> foca a busca manual para agilizar.
  useEffect(() => { if (res && res.naoReconhecido && buscaRef.current) buscaRef.current.focus(); }, [res]);

  const qq = q.trim();
  const qd = qq.replace(/\D/g, '');
  const matches = qq.length < 2 ? [] : (lista || []).filter((p) => {
    if (qd && (String(p.documento || '').replace(/\D/g, '').includes(qd) || String(p.telefone || '').replace(/\D/g, '').includes(qd))) return true;
    return norm(p.nome).includes(norm(qq)) || norm(p.email).includes(norm(qq));
  }).slice(0, 8);

  // Mostra o resultado e o MANTÉM na tela até a próxima leitura (modo painel).
  // Nada de auto-dismiss: as infos da pessoa ficam visíveis para a equipe analisar;
  // o card só some quando bate outro QR ou quando tocam em "continuar lendo".
  function mostrarResultado(r) {
    setRes(r);
    setCompradorLocal(r ? !!r.comprador : false);
    if (r && r.status === 'ok') {
      setContador((c) => c + 1);
      if (r.id) {
        const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        setRecentes((l) => [{ id: r.id, nome: r.nome, hora }, ...l.filter((x) => x.id !== r.id)].slice(0, 4));
      }
    }
  }

  // Marca/desmarca "possível comprador" direto no card do check-in (otimista).
  async function toggleComprador() {
    if (!res || !res.id || !onMarcarComprador) return;
    const novo = !compradorLocal;
    setCompradorLocal(novo);
    try { await onMarcarComprador(res.id, novo, res.nome); }
    catch { setCompradorLocal(!novo); }
  }

  // Desfaz um credenciamento feito nesta sessão (scan/toque na pessoa errada).
  function desfazer(r) {
    if (!onUndo) return;
    onUndo(r.id, r.nome);
    setRecentes((l) => l.filter((x) => x.id !== r.id));
    setContador((c) => Math.max(0, c - 1));
  }

  // Pessoa é de outro evento/dia: troca o evento ativo e credencia em um toque.
  async function trocarECredenciar(troca) {
    if (busy.current || !onTrocarEvento) return;
    busy.current = true; setPronto(false);
    try { mostrarResultado(await onTrocarEvento(troca)); }
    catch { mostrarResultado({ status: 'erro', nome: 'Erro ao trocar de evento' }); }
    setTimeout(() => { busy.current = false; setPronto(true); }, BUSY_LOCK_MS);
  }

  // Walk-in: cadastra (nome + tipo) e já credencia, sem sair do scanner.
  async function cadastrarRapido() {
    const nome = qq;
    if (busy.current || !onQuickAdd || nome.length < 3) return;
    busy.current = true; setPronto(false);
    try {
      const r = await onQuickAdd({ nome, tipo: quickTipo });
      mostrarResultado(r);
      // Falhou (sem internet, servidor fora): mantém o nome digitado para o operador
      // tentar de novo sem redigitar. Só limpa quando realmente cadastrou.
      if (!r || r.status !== 'erro') { setQ(''); setQuickTipo('comprador'); }
    } catch {
      mostrarResultado({
        status: 'erro', titulo: 'Não deu para cadastrar', nome,
        sub: 'Tente de novo. Se continuar falhando, anote o nome no papel e NÃO libere a entrada ainda.',
      });
    }
    setTimeout(() => { busy.current = false; setPronto(true); }, BUSY_LOCK_MS);
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
    let detecting = false; // evita detecções nativas sobrepostas
    const canvas = document.createElement('canvas');
    const cx = canvas.getContext('2d', { willReadFrequently: true });
    // Detector nativo do navegador (Android/Chrome): decodifica direto do vídeo,
    // sem copiar frame para canvas — mais rápido e mais frio. jsQR fica de fallback.
    let detector = null;
    try {
      if ('BarcodeDetector' in window) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch { detector = null; }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then((s) => { stream = s; setErro(''); const v = videoRef.current; if (v) { v.srcObject = s; v.play().catch(() => {}); } loop(); })
      .catch(() => setErro('camera'));

    function achou(data, now) {
      const c = String(data || '').trim();
      if (!c) return;
      const l = last.current;
      const aindaEmQuadro = l && l.code === c && (now - l.at) < GAP_MS;
      // Mesmo QR continua na frente da câmera: só atualiza o "visto agora", não reprocessa.
      last.current = { code: c, at: now };
      if (!aindaEmQuadro) process(c);
    }

    function loop(ts) {
      rafRef.current = requestAnimationFrame(loop);
      const now = ts || (typeof performance !== 'undefined' ? performance.now() : 0);
      if (now - lastScan < SCAN_EVERY_MS) return;
      lastScan = now;

      const v = videoRef.current;
      if (!v || v.readyState !== v.HAVE_ENOUGH_DATA || busy.current || detecting) return;

      if (detector) {
        detecting = true;
        detector.detect(v)
          .then((codes) => achou(codes && codes[0] && codes[0].rawValue, performance.now()))
          .catch(() => { detector = null; }) // navegador anuncia mas não suporta -> jsQR
          .finally(() => { detecting = false; });
        return;
      }

      // Fallback jsQR: downscale para acelerar e manter a câmera fluida em sessões longas.
      const scale = Math.min(1, MAX_SCAN_W / (v.videoWidth || MAX_SCAN_W));
      canvas.width = Math.round((v.videoWidth || MAX_SCAN_W) * scale);
      canvas.height = Math.round((v.videoHeight || MAX_SCAN_W) * scale);
      cx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const img = cx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (code) achou(code.data, now);
    }

    async function process(code) {
      busy.current = true; setPronto(false);
      try { mostrarResultado(await cbRef.current(code)); }
      catch { mostrarResultado({ status: 'erro', nome: 'Erro ao processar' }); }
      setTimeout(() => { busy.current = false; setPronto(true); }, BUSY_LOCK_MS);
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
    // `tentativaCam` só muda no botão "Tentar de novo": remonta a câmera sem fechar
    // o scanner. A máquina de leitura (busy/last/GAP) vive em refs e não é afetada.
  }, [tentativaCam]);

  const st = res && (STATUS[res.status] || STATUS.erro);
  const stTxt = res && (res.titulo || st.txt);

  // Card do resultado — o MESMO nos dois cenários (câmera ok e câmera bloqueada).
  // Sem ele no modo "sem câmera", credenciar pela busca manual não daria retorno nenhum.
  const painelResultado = (
    <div className={`scan-result ${res ? st.cls : 'idle'} ${res && compradorLocal ? 'is-comprador' : ''}`}>
      {!res && (
        <div className="scan-hint">
          <div className="scan-hint-big">Leitura contínua ativa</div>
          Aponte a câmera para o QR do crachá/celular.<br />
          Pode escanear um após o outro, sem fechar esta tela.<br />
          <span className="scan-hint-min">As informações da pessoa ficam aqui até o próximo QR.</span>
        </div>
      )}
      {res && (
        <div className="scan-card">
          <div className="scan-card-head">
            {res.foto
              ? <img className="scan-foto" src={res.foto} alt={res.nome} />
              : <div className={`scan-foto scan-foto-ph avatar-${res.tipo ? tipoCls(res.tipo) : 'comum'}`}>{res.status === 'erro' ? '✕' : initials(res.nome)}</div>}
            <div className="scan-card-id">
              <div className="scan-nome">{res.nome}</div>
              <div className="scan-badges">
                {res.nivel && <span className="scan-nivel">{res.nivel}</span>}
                {res.ingresso && <span className={`scan-ingresso ing-${res.ingresso.toLowerCase()}`}>{res.ingresso}</span>}
                {res.tipo && <span className={`tbadge tbadge-${tipoCls(res.tipo)}`}>{tipoLabel(res.tipo)}</span>}
              </div>
            </div>
          </div>

          <div className={`scan-status ${st.cls}`} role="status">
            <span className="scan-status-ico" aria-hidden="true">{st.ico}</span>
            <span>{stTxt}</span>
          </div>
          {res.sub && <div className="scan-sub">{res.sub}</div>}

          {res.status !== 'erro' && (
            <div className="scan-perfil">
              {compradorLocal && <div className="scan-comprador-selo">★ Possível comprador</div>}
              {(res.turma || res.grupo || res.camisa) && (
                <div className="scan-extras">
                  {res.turma && <span className="scan-chip">Turma <b>{res.turma}</b></span>}
                  {res.camisa && <span className="scan-chip">Camisa <b>{res.camisa}</b></span>}
                  {res.grupo && <span className="scan-chip">No grupo: <b>{res.grupo}</b></span>}
                </div>
              )}
              {res.profissao && <div className="scan-linha"><span>Profissão</span><b>{res.profissao}</b></div>}
              {res.faturamento && <div className="scan-linha"><span>Faturamento</span><b>{res.faturamento}</b></div>}
              {res.cidade && <div className="scan-linha"><span>Cidade</span><b>{res.cidade}</b></div>}
              {res.telefone && (
                <div className="scan-linha"><span>WhatsApp</span>
                  <a href={`https://wa.me/${(res.telefone || '').replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}>{res.telefone}</a>
                </div>
              )}
            </div>
          )}

          {res.trocaEvento && (
            <button type="button" className="btn primary scan-troca"
              onClick={(e) => { e.stopPropagation(); trocarECredenciar(res.trocaEvento); }}>
              Credenciar em {res.trocaEvento.nome}
            </button>
          )}

          {res.status !== 'erro' && res.id && (
            <div className="scan-card-actions">
              {onMarcarComprador && (
                <button type="button" className={`btn ${compradorLocal ? '' : 'primary'} scan-act`}
                  onClick={(e) => { e.stopPropagation(); toggleComprador(); }}>
                  {compradorLocal ? '✓ É possível comprador' : '★ Marcar possível comprador'}
                </button>
              )}
            </div>
          )}

          {/* Limpa o card antes do próximo QR. No celular o visor e a busca já ficam
              visíveis com o card aberto (layout de 3 zonas), então isto é opcional. */}
          <button type="button" className="scan-continuar" onClick={() => setRes(null)}>
            Limpar e continuar lendo →
          </button>
        </div>
      )}
    </div>
  );

  return (
    // Sem fechar por clique fora: um toque acidental no overlay não pode derrubar
    // a leitura contínua no meio da fila — fecha só pelo X ou "Encerrar leitura".
    <div className="modal-overlay scanner-overlay">
      <div className="modal modal-lg scanner-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>Credenciando: {eventoNome || '—'}</h3>
          <div className="scan-head-right">
            {contador > 0 && <span className="scan-counter"><IconCheck /> {contador} nesta sessão</span>}
            {/* Fila offline visível AQUI dentro: a equipe passa o evento inteiro nesta tela. */}
            {pendentes > 0 && (
              <span className="scan-pend" title="Credenciamentos salvos no aparelho, ainda não enviados. Somem sozinhos quando a internet voltar.">
                {pendentes} p/ enviar
              </span>
            )}
            {!online && <span className="scan-pend off">Sem internet</span>}
            <button type="button" className="scan-ajuda-btn" onClick={() => setAjuda((v) => !v)}
              aria-expanded={ajuda} aria-controls="scan-ajuda-painel" title="Ajuda rápida">
              ?<span className="sr-only"> Ajuda rápida</span>
            </button>
            <button className="icon-btn" onClick={onClose} title="Fechar"><IconClose /></button>
          </div>
        </div>
        <div className="modal-body">
          {diaErrado && (
            <div className="scan-dia-errado" role="alert">
              <span>Você está credenciando <strong>{eventoNome}</strong>, mas hoje é <strong>{nomeDeHoje}</strong>.</span>
              {onIrParaHoje && (
                <button type="button" className="btn primary" onClick={onIrParaHoje}>Trocar para {nomeDeHoje}</button>
              )}
            </div>
          )}

          {ajuda && (
            <div className="scan-ajuda-painel" id="scan-ajuda-painel">
              <div className="scan-ajuda-head">
                <strong>Ajuda rápida</strong>
                <button type="button" className="btn" onClick={() => setAjuda(false)}>Fechar</button>
              </div>
              <ul className="scan-ajuda-lista">
                <li>
                  <b>O QR não lê</b>
                  <span>Busque a pessoa por nome ou CPF no campo lá embaixo (ele fica sempre
                    visível, mesmo com o cartão aberto) e toque no nome dela.</span>
                </li>
                <li>
                  <b>A pessoa não está na lista</b>
                  <span>Busque pelo nome. Se não aparecer ninguém, surge o botão “Cadastrar e credenciar”. Use ele.</span>
                </li>
                <li>
                  <b>Diz “Já estava credenciado”</b>
                  <span>Confira o nome na tela. É a mesma pessoa? Então ela já entrou hoje. Se for outra pessoa, chame o responsável.</span>
                </li>
                <li>
                  <b>Diz “QR de outro dia”</b>
                  <span>Aparece um botão “Credenciar em [dia]” no cartão. Toque nele: troca de dia e credencia.</span>
                </li>
                <li>
                  <b>Sem internet</b>
                  <span>Pode continuar escaneando normal. Fica salvo no aparelho e envia sozinho quando a internet voltar. Só o cadastro de gente nova precisa de internet.</span>
                </li>
              </ul>
            </div>
          )}
          {erro ? (
            // Sem câmera o credenciamento continua pela busca manual — por isso o
            // card de resultado tem que aparecer aqui também.
            <div className="scan-sem-camera">
            <div className="scan-cam-erro" role="alert">
              <div className="sce-titulo">A câmera está bloqueada neste aparelho</div>
              <div className="sce-ok">
                Você <strong>pode continuar credenciando</strong>: busque a pessoa por nome ou CPF
                no campo aqui embaixo e toque no nome dela.
              </div>
              <div className="sce-passos-label">Para liberar a câmera:</div>
              <ol className="sce-passos">
                <li>Toque no <strong>cadeado</strong> ao lado do endereço do site, no topo da tela.</li>
                <li>Escolha <strong>Câmera</strong>.</li>
                <li>Marque <strong>Permitir</strong>.</li>
                <li>Recarregue a página e abra o scanner de novo.</li>
              </ol>
              <button type="button" className="btn primary sce-retry"
                onClick={() => { setErro(''); setTentativaCam((t) => t + 1); }}>
                Tentar a câmera de novo
              </button>
            </div>
            {painelResultado}
            </div>
          ) : (
            <div className="scan-grid">
              <div className="scan-wrap">
                <video ref={videoRef} autoPlay playsInline muted className="scan-video" />
                <div className={`scan-frame ${pronto ? 'pronto' : 'lendo'}`} />
                <div className={`scan-state ${pronto ? 'pronto' : 'lendo'}`}>
                  <span className="dot" />{pronto ? 'Pronto — aponte o próximo QR' : 'Lendo…'}
                </div>
              </div>
              {painelResultado}
            </div>
          )}
          {recentes.length > 0 && (
            <div className="scan-recentes">
              <span className="scan-recentes-label">Últimos:</span>
              {recentes.map((r) => (
                <span key={r.id} className="scan-recente">
                  {r.nome} <em>{r.hora}</em>
                  <button type="button" onClick={() => desfazer(r)} title="Desfazer credenciamento">Desfazer</button>
                </span>
              ))}
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
            {qq.length >= 2 && matches.length === 0 && (
              <div className="scan-manual-empty">
                Ninguém encontrado nesta lista.
                {onQuickAdd && qq.length >= 3 && !/^\d+$/.test(qq) && (
                  <div className="scan-quick">
                    <select value={quickTipo} onChange={(e) => setQuickTipo(e.target.value)}>
                      <option value="comprador">Comprador</option>
                      <option value="convidado">Convidado</option>
                      <option value="socio">Sócio</option>
                      <option value="diamante">Diamante</option>
                      <option value="comum">Comum</option>
                    </select>
                    <button type="button" className="btn primary" onClick={cadastrarRapido}>
                      Cadastrar e credenciar “{qq}”
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Encerrar leitura</button>
        </div>
      </div>
    </div>
  );
}
