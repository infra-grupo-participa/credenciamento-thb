import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, auth } from './api.js';
import { useToast } from './components/Toasts.jsx';
import Login from './components/Login.jsx';
import ParticipantModal from './components/ParticipantModal.jsx';
import DetailModal from './components/DetailModal.jsx';
import EventBar from './components/EventBar.jsx';
import HistoryModal from './components/HistoryModal.jsx';
import ScannerModal from './components/ScannerModal.jsx';
import DashboardModal from './components/DashboardModal.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import { beepOk, beepErr, beepDup } from './beep.js';
import { enfileirar, flushFila, tamanhoFila } from './offline.js';
import { tipoLabel, tipoCls } from './tipos.js';
import { nivelLabel, ingressoLabel, ehPossivelComprador, faturamentoDe } from './perfil.js';
import { linhasExport, aplicarQrImagem } from './exportRows.js';
import { useOcioso } from './useOcioso.js';
import {
  IconImport, IconExport, IconPlus, IconSearch, IconCheck, IconSquare, IconEdit, IconLogout, IconReset,
  IconQr, IconMore, IconChart, IconSettings, IconClose,
} from './icons.jsx';

const POLL_MS = 5000;
// Tela parada há 10 min: para de consultar o servidor até alguém encostar nela.
const OCIOSO_MS = 10 * 60 * 1000;
// A lista de eventos muda uma vez por semana, não a cada 15 s.
const POLL_EVENTOS_MS = 60000;
// Rede de segurança do delta. Dois aparelhos podem gravar no mesmo milissegundo
// (já há registros assim no banco), e nesse caso o `updated_at > since` do
// servidor pode deixar uma linha para trás. De tempos em tempos a lista é refeita
// inteira, então qualquer divergência morre em minutos em vez de durar o evento.
// Custa ~40 kB por aparelho a cada 10 min; barato perto de exibir lista furada.
const RECONCILIA_MS = 10 * 60 * 1000;

const norm = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const initials = (n) => {
  if (!n) return '?';
  const p = n.trim().split(/\s+/);
  return ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
};
const horaAgora = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
// Data de hoje no fuso do aparelho, no mesmo formato do campo `data` do evento (yyyy-mm-dd).
const hojeISO = () => new Date().toLocaleDateString('sv-SE');
// Evento que a equipe deve usar AGORA: o do dia de hoje. Sem nenhum batendo,
// mantém o antigo (primeiro ativo por ordem) para não mudar o comportamento conhecido.
function eventoPadrao(eventos) {
  const ativos = (eventos || []).filter((e) => !e.arquivado).sort((a, b) => a.ordem - b.ordem);
  const hoje = hojeISO();
  return ativos.find((e) => e.data === hoje) || ativos[0] || null;
}
function grupoBadge(g) {
  if (!g) return <span style={{ color: 'var(--muted)' }}>—</span>;
  const v = String(g).trim();
  const sim = /^sim/i.test(v); const nao = /^n[ãa]o/i.test(v);
  return <span className={`gbadge ${sim ? 'gsim' : nao ? 'gnao' : ''}`}>{sim ? 'SIM' : nao ? 'NÃO' : v}</span>;
}

export default function App() {
  const [operador, setOperador] = useState(auth.token ? auth.operador : null);
  const [checando, setChecando] = useState(!!auth.token);
  const [avisoLogin, setAvisoLogin] = useState('');
  const [semRede, setSemRede] = useState(false);

  useEffect(() => {
    let vivo = true;
    let timer = 0;
    // O /me só pode derrubar a sessão quando o servidor diz 401 (tratado pelo evento
    // 'chf:unauthorized'). Piscada de rede no boot NÃO desloga: mantém o operador,
    // avisa e tenta de novo — Wi-Fi de evento cai o tempo todo.
    function checar() {
      api.me()
        .then((d) => { if (vivo) { setOperador(d.operador); setSemRede(false); } })
        .catch((e) => {
          if (!vivo) return;
          if (e?.code === 'network') { setSemRede(true); timer = setTimeout(checar, 5000); }
        })
        .finally(() => { if (vivo) setChecando(false); });
    }
    if (auth.token) checar();
    const onUnauth = () => {
      setOperador(null); setChecando(false);
      setAvisoLogin('Sua sessão expirou. Entre de novo para continuar — nada do que você credenciou foi perdido.');
    };
    window.addEventListener('chf:unauthorized', onUnauth);
    return () => { vivo = false; clearTimeout(timer); window.removeEventListener('chf:unauthorized', onUnauth); };
  }, []);

  if (checando) return <div className="center-screen"><div className="spinner" /></div>;
  if (!operador) return <Login aviso={avisoLogin} onLogin={(nome) => { setOperador(nome); setChecando(false); setAvisoLogin(''); }} />;
  return (
    <>
      {semRede && navigator.onLine && (
        <div className="offline-banner">
          <span>Sem conexão com o servidor — tentando de novo. Pode continuar credenciando: sincroniza sozinho quando voltar.</span>
        </div>
      )}
      <Credenciamento operador={operador} onLogout={() => { auth.clear(); setOperador(null); }} />
    </>
  );
}

function Credenciamento({ operador, onLogout }) {
  const qc = useQueryClient();
  const toast = useToast();

  const [eventoId, setEventoId] = useState(null);
  const [filtro, setFiltro] = useState('todos');
  const [tipoFiltro, setTipoFiltro] = useState('todos');
  const [ingressoFiltro, setIngressoFiltro] = useState('todos'); // DIAMOND/VIP/PLATEIA/diamante
  const [compradorFiltro, setCompradorFiltro] = useState('todos'); // sim/nao (possível comprador Aurum)
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState('nome');
  const [filtros, setFiltros] = useState([]); // [{ col, key, label }]
  const [novoCol, setNovoCol] = useState('');
  const [filtrosOpen, setFiltrosOpen] = useState(false);
  const [editando, setEditando] = useState(undefined);
  const [novoNome, setNovoNome] = useState('');
  const [detalheId, setDetalheId] = useState(null);
  const [histOpen, setHistOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [view, setView] = useState('lista'); // 'lista' | 'dashboard' — página atual
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [maisOpen, setMaisOpen] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [pendentes, setPendentes] = useState(tamanhoFila());
  const fileRef = useRef(null);
  const ultimoFullRef = useRef(0); // quando a lista inteira foi baixada pela última vez
  const searchRef = useRef(null);
  const maisRef = useRef(null);

  // Fecha o menu "Mais ações" ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!maisOpen) return;
    function onDoc(e) { if (maisRef.current && !maisRef.current.contains(e.target)) setMaisOpen(false); }
    function onEsc(e) { if (e.key === 'Escape') setMaisOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); };
  }, [maisOpen]);

  useEffect(() => {
    function onKey(e) {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'select' || tag === 'textarea';
      if (!typing && (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'))) {
        e.preventDefault(); searchRef.current?.focus();
      }
      // Esc não fecha o scanner enquanto se digita na busca manual (evita fechar sem querer).
      if (e.key === 'Escape' && !typing) setScanOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Sincroniza a fila offline quando a conexão volta (e ao abrir).
  useEffect(() => {
    async function sincronizar() {
      const n = await flushFila((id, cred) => api.credenciar(id, cred));
      setPendentes(tamanhoFila());
      if (n > 0) {
        toast(`${n} credenciamento(s) sincronizado(s)`, 'success');
        qc.invalidateQueries({ queryKey: ['participantes'] });
        qc.invalidateQueries({ queryKey: ['eventos'] });
      }
    }
    const up = () => { setOnline(true); sincronizar(); };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    if (navigator.onLine) sincronizar();
    // Retry periódico: o evento 'online' NÃO dispara quando o Wi-Fi continua conectado
    // mas o servidor engasgou por alguns minutos (cenário comum em centro de convenções).
    // Sem isto a fila ficaria parada até alguém recarregar a página — e o texto na tela
    // promete que ela some sozinha. Só bate no servidor se houver algo pendente.
    const tick = setInterval(() => { if (navigator.onLine && tamanhoFila() > 0) sincronizar(); }, 20000);
    return () => {
      clearInterval(tick);
      window.removeEventListener('online', up); window.removeEventListener('offline', down);
    };
  }, []);

  // Enquanto ninguém encosta na tela, nenhuma das duas listas consulta o servidor.
  const ocioso = useOcioso(OCIOSO_MS);
  // Ao voltar da pausa, ressincroniza na hora em vez de esperar o próximo tick.
  // Só na TRANSIÇÃO ocioso->ativo: sem o ref, este efeito também dispararia na
  // montagem (quando `ocioso` já nasce false) e duplicaria a carga inicial.
  const eraOciosoRef = useRef(false);
  useEffect(() => {
    if (!ocioso && eraOciosoRef.current) qc.invalidateQueries({ queryKey: ['participantes'] });
    eraOciosoRef.current = ocioso;
  }, [ocioso, qc]);

  const { data: eventosData } = useQuery({
    queryKey: ['eventos'], queryFn: api.eventos,
    refetchInterval: ocioso ? false : POLL_EVENTOS_MS,
  });
  const eventos = eventosData?.eventos || [];

  // Abre SEMPRE no dia de hoje (evento cuja `data` é a de hoje). Num evento de 3 dias,
  // abrir no dia 1 no dia 2 credenciaria centenas de pessoas na lista errada.
  useEffect(() => {
    if (!eventoId && eventos.length) {
      const ativo = eventoPadrao(eventos);
      if (ativo) setEventoId(ativo.id);
    }
  }, [eventos, eventoId]);

  const eventoAtual = eventos.find((e) => e.id === eventoId);
  const readOnly = !!eventoAtual?.arquivado;
  // Rede de segurança: existe um evento com a data de hoje e não é o que está aberto.
  const eventoDeHoje = eventos.find((e) => !e.arquivado && e.data === hojeISO());
  // Compara pela DATA do evento aberto (não pelo id do "evento de hoje"): se houver
  // mais de um evento com a data de hoje, estar em qualquer um deles é estar certo.
  const diaErrado = !!(eventoDeHoje && eventoAtual && eventoAtual.data !== hojeISO());

  const { data, isError, isFetching, isLoading } = useQuery({
    queryKey: ['participantes', eventoId],
    // Delta-polling: manda o "estado" atual (updatedAt + tamanho); se nada mudou,
    // o servidor responde `unchanged` e mantemos o mesmo objeto (zero re-render).
    queryFn: async () => {
      const prev = qc.getQueryData(['participantes', eventoId]);
      // A cada RECONCILIA_MS ignora o cache de propósito e refaz a lista inteira.
      const agora = Date.now();
      const reconciliar = agora - ultimoFullRef.current >= RECONCILIA_MS;
      const d = reconciliar
        ? await api.listar(eventoId)
        : await api.listar(eventoId, prev?.updatedAt, prev?.list?.length);
      if (d?.list) ultimoFullRef.current = agora; // veio lista cheia (pedida ou não)
      if (d?.unchanged && prev) return prev;
      // `delta`: vieram só as linhas alteradas — costura por id sobre a lista que
      // já está na mão. A ordem não importa aqui, a tela reordena sozinha.
      if (d?.delta && prev?.list) {
        const porId = new Map(prev.list.map((p) => [p.id, p]));
        for (const p of d.changed) porId.set(p.id, p);
        const list = [...porId.values()];
        // Trava: se o resultado do merge não bate com a contagem do servidor,
        // alguma linha escapou do delta. Em vez de exibir lista furada no balcão,
        // busca tudo de novo (custa banda uma vez, não mente sobre quem chegou).
        if (list.length === d.count) return { list, updatedAt: d.updatedAt };
        return await api.listar(eventoId);
      }
      return d;
    },
    enabled: !!eventoId,
    refetchInterval: ocioso ? false : POLL_MS,
    refetchOnWindowFocus: true,
  });
  const lista = data?.list || [];

  const credenciarMut = useMutation({
    mutationFn: async ({ id, credenciado }) => {
      try { return await api.credenciar(id, credenciado); }
      catch (e) {
        if (!navigator.onLine || e?.code === 'network') {
          enfileirar({ id, credenciado }); setPendentes(tamanhoFila());
          return { offline: true };
        }
        throw e;
      }
    },
    onMutate: async ({ id, credenciado }) => {
      await qc.cancelQueries({ queryKey: ['participantes', eventoId] });
      const prev = qc.getQueryData(['participantes', eventoId]);
      qc.setQueryData(['participantes', eventoId], (old) => old && {
        ...old, list: old.list.map((p) => (p.id === id ? { ...p, credenciado, recebeuCracha: credenciado } : p)),
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['participantes', eventoId], ctx.prev); beepErr(); toast('Erro ao salvar', 'danger'); },
    onSuccess: (d, { credenciado, nome }) => {
      if (credenciado) beepOk();
      if (d && d.offline) toast(`✓ ${nome} (salvo offline — sincroniza ao reconectar)`, 'success');
      else toast(credenciado ? `✓ ${nome} credenciado(a)!` : `${nome} marcado como pendente`, credenciado ? 'success' : '');
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['participantes', eventoId] }); qc.invalidateQueries({ queryKey: ['eventos'] }); },
  });

  // Marca/desmarca "possível comprador" (sinal alimentado pela equipe). Propaga
  // para a mesma pessoa nos 3 dias no servidor; aqui atualiza a lista do dia atual
  // de forma otimista (a flag vive em dados_extra.possivel_comprador).
  const marcarComprador = useCallback(async (id, valor, nome) => {
    qc.setQueryData(['participantes', eventoId], (old) => old && {
      ...old,
      list: old.list.map((p) => (p.id === id
        ? { ...p, dados_extra: { ...(p.dados_extra || {}), ...(valor ? { possivel_comprador: true } : {}) } }
        : p)),
    });
    // Remove a chave quando desmarcado (o spread acima não apaga).
    if (!valor) {
      qc.setQueryData(['participantes', eventoId], (old) => old && {
        ...old,
        list: old.list.map((p) => {
          if (p.id !== id) return p;
          const de = { ...(p.dados_extra || {}) }; delete de.possivel_comprador;
          return { ...p, dados_extra: de };
        }),
      });
    }
    try {
      await api.marcarComprador(id, valor);
      toast(valor ? `✓ ${nome || ''} marcado como possível comprador` : `${nome || ''} desmarcado`, valor ? 'success' : '');
    } catch {
      toast('Não consegui salvar a marcação', 'danger');
    } finally {
      qc.invalidateQueries({ queryKey: ['participantes', eventoId] });
    }
  }, [qc, eventoId, toast]);

  const filtrada = useMemo(() => {
    const q = norm(busca.trim());
    const arr = lista.filter((x) => {
      if (filtro === 'credenciados' && !x.credenciado) return false;
      if (filtro === 'pendentes' && x.credenciado) return false;
      if (tipoFiltro !== 'todos' && x.tipo !== tipoFiltro) return false;
      if (ingressoFiltro !== 'todos') {
        const ing = ingressoLabel(x);
        if (ingressoFiltro === 'diamante') { if (ing) return false; } // sem ingresso pago = diamante convidado
        else if (ing !== ingressoFiltro) return false;
      }
      if (compradorFiltro === 'sim' && !ehPossivelComprador(x)) return false;
      if (compradorFiltro === 'nao' && ehPossivelComprador(x)) return false;
      for (const f of filtros) {
        const rv = norm(String((x.dados_extra && x.dados_extra[f.col]) || '').trim());
        if (rv !== f.key) return false;
      }
      if (!q) return true;
      // Busca por dígitos (CPF/telefone) ignorando pontuação — útil no balcão (ex.: últimos dígitos).
      const qd = q.replace(/\D/g, '');
      if (qd && (String(x.documento || '').replace(/\D/g, '').includes(qd) || String(x.telefone || '').replace(/\D/g, '').includes(qd))) return true;
      return norm(x.nome).includes(q) || norm(x.email).includes(q) || norm(x.turma).includes(q)
        || norm(x.telefone).includes(q) || norm(x.nomeCracha).includes(q) || norm(x.convidadoPor).includes(q)
        || norm(x.documento).includes(q);
    });
    arr.sort((a, b) => {
      if (ordem === 'nome') return a.nome.localeCompare(b.nome, 'pt-BR');
      if (ordem === 'nome-desc') return b.nome.localeCompare(a.nome, 'pt-BR');
      if (ordem === 'turma') return (a.turma || '').localeCompare(b.turma || '', 'pt-BR', { numeric: true });
      if (ordem === 'tipo') return (a.tipo || '').localeCompare(b.tipo || '') || a.nome.localeCompare(b.nome, 'pt-BR');
      if (ordem === 'credenciado-first') return (b.credenciado - a.credenciado) || a.nome.localeCompare(b.nome, 'pt-BR');
      if (ordem === 'pendente-first') return (a.credenciado - b.credenciado) || a.nome.localeCompare(b.nome, 'pt-BR');
      return 0;
    });
    return arr;
  }, [lista, busca, filtro, tipoFiltro, ingressoFiltro, compradorFiltro, ordem, filtros]);

  // Colunas disponíveis (todas as da planilha original) para filtro avançado.
  const colunas = useMemo(() => {
    const s = new Set();
    lista.forEach((p) => { if (p.dados_extra && typeof p.dados_extra === 'object') Object.keys(p.dados_extra).forEach((k) => s.add(k)); });
    return [...s].sort();
  }, [lista]);

  // Valores distintos (com contagem) que aparecem numa coluna — para o operador escolher.
  function valoresDe(col) {
    const m = new Map();
    lista.forEach((p) => {
      const raw = p.dados_extra && p.dados_extra[col];
      const v = raw == null ? '' : String(raw).trim();
      if (!v) return;
      const k = norm(v);
      if (!m.has(k)) m.set(k, { key: k, label: v, count: 0 });
      m.get(k).count++;
    });
    return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'));
  }
  function addFiltro(col, key) {
    const v = valoresDe(col).find((x) => x.key === key);
    if (!v) return;
    if (filtros.some((f) => f.col === col && f.key === key)) return;
    setFiltros([...filtros, { col, key, label: v.label }]);
  }

  // Render incremental: listas grandes (evento 5x) não travam o celular —
  // mostra os primeiros N e um botão para carregar o resto (a busca filtra tudo).
  const [limite, setLimite] = useState(250);
  useEffect(() => { setLimite(250); }, [eventoId, busca, filtro, tipoFiltro, ingressoFiltro, compradorFiltro, ordem, filtros]);
  const visiveis = limite < filtrada.length ? filtrada.slice(0, limite) : filtrada;

  // Callbacks estáveis para as linhas memoizadas (não re-renderiza a tabela toda a cada poll).
  const { mutate: credenciarLinha } = credenciarMut;
  const onToggleLinha = useCallback((p) => credenciarLinha({ id: p.id, credenciado: !p.credenciado, nome: p.nome }), [credenciarLinha]);
  const onEditLinha = useCallback((p) => setEditando(p), []);
  const onDetailLinha = useCallback((p) => setDetalheId(p.id), []);

  const total = lista.length;
  const cred = lista.filter((x) => x.credenciado).length;
  const pend = total - cred;
  const pct = total ? Math.round((cred / total) * 100) : 0;

  // Ritmo do credenciamento (última hora) — visão de controle durante o evento.
  const ultimaHora = useMemo(() => {
    const corte = Date.now() - 3600_000;
    return lista.filter((x) => {
      if (!x.credenciado || !x.dataCredenciamento) return false;
      const t = Date.parse(x.dataCredenciamento);
      return !isNaN(t) && t >= corte;
    }).length;
  }, [lista]);

  // "Sincronizando…" só na carga inicial — o poll de 5s não fica piscando o status.
  const sync = isError ? { k: 'err', t: 'Erro de conexão' }
    : isLoading ? { k: 'warn', t: 'Carregando…' }
    : { k: 'ok', t: `Sincronizado · ${horaAgora()}` };

  async function exportar() {
    try {
      const d = await api.exportar(eventoId);
      const XLSX = await import('xlsx');
      const origin = window.location.origin;
      const rows = linhasExport(d.list, origin);
      const ws = XLSX.utils.json_to_sheet(rows);
      aplicarQrImagem(XLSX, ws); // fórmula =IMAGE() na coluna do QR + larguras
      const wbk = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wbk, ws, 'Credenciamento');
      XLSX.writeFile(wbk, `credenciamento-${eventoId}.xlsx`);
      toast('Excel exportado (QR como imagem via IMAGE)', 'success');
    } catch { toast('Erro ao exportar', 'danger'); }
  }
  function abrirImport() { fileRef.current?.click(); }
  function onImportFile(e) {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const arr = JSON.parse(reader.result);
        if (!Array.isArray(arr)) throw 0;
        if (!confirm(`Importar ${arr.length} registros para "${eventoAtual?.nome}"? Isso substitui a lista deste evento.`)) return;
        await api.importar(eventoId, arr);
        qc.invalidateQueries({ queryKey: ['participantes', eventoId] });
        qc.invalidateQueries({ queryKey: ['eventos'] });
        toast('Importado com sucesso', 'success');
      } catch { toast('Arquivo inválido', 'danger'); }
    };
    reader.readAsText(file);
  }

  // Leitura de QR -> credencia pelo id embutido (em qualquer evento).
  // Recebe o conteúdo do QR (token, id, ou link /qr/<token>) e resolve no dia ativo.
  // Credencia uma pessoa (objeto da lista ou do resolver) e devolve o cartão de resultado.
  //
  // Fluxo "bateu o QR, já vai": confirma na hora (verde + beep) e grava em background.
  // Se a rede falhar, cai na fila offline e sincroniza depois — não perde o credenciamento.
  function credenciarPessoa(det) {
    const ex = det.dados_extra && typeof det.dados_extra === 'object' ? det.dados_extra : {};
    const grupo = det.grupo || ex['Entrou no grupo?'] || ex['Está no grupo?'] || ex['Está no grupo da Imersão?'] || '';
    // id incluído para o "Desfazer" da sessão do scanner.
    // Card do scanner em modo painel: leva o perfil que a equipe usa para
    // organizar/analisar (nível THB, ingresso, possível comprador, contato).
    const info = {
      id: det.id, nome: det.nome, tipo: det.tipo, turma: det.turma, camisa: det.tamanhoCamisa,
      nivel: nivelLabel(det), ingresso: ingressoLabel(det), comprador: ehPossivelComprador(det),
      profissao: det.profissao || '', faturamento: faturamentoDe(det),
      cidade: [det.cidade, det.estado].filter(Boolean).join(' / '),
      telefone: det.telefone || '', email: det.email || '',
    };
    if (grupo) info.grupo = grupo;

    // Som PRÓPRIO para duplicado: em salão barulhento o operador não pode confundir
    // "entrou agora" com "já tinha entrado".
    if (det.credenciado) { beepDup(); return { status: 'duplicado', ...info }; }

    // Confirma de imediato; a gravação acontece em background (não trava a fila).
    beepOk();
    api.credenciar(det.id, true)
      .then(() => {
        qc.invalidateQueries({ queryKey: ['participantes', det.evento_id] });
        qc.invalidateQueries({ queryKey: ['participantes', eventoId] });
        qc.invalidateQueries({ queryKey: ['eventos'] });
      })
      .catch((e) => {
        if (!navigator.onLine || e?.code === 'network') {
          // Piscou a rede: enfileira para sincronizar quando voltar (já mostramos OK).
          enfileirar({ id: det.id, credenciado: true });
          setPendentes(tamanhoFila());
        } else {
          // Falha real do servidor: avisa para reescanear e reflete o estado verdadeiro.
          beepErr();
          toast(`Falha ao gravar ${det.nome} — escaneie de novo`, 'danger');
          qc.invalidateQueries({ queryKey: ['participantes', det.evento_id] });
          qc.invalidateQueries({ queryKey: ['participantes', eventoId] });
        }
      });
    return { status: 'ok', ...info };
  }

  async function aoEscanear(raw) {
    let code = String(raw || '').trim();
    const m = code.match(/\/qr\/([^/?#]+)/);
    if (m) code = decodeURIComponent(m[1]); // QR que codifica o link inteiro

    // 1º: resolve na lista já carregada — confirmação instantânea (sem ida ao
    // servidor) e funciona mesmo se a rede cair. O servidor fica como fallback
    // para identificar QR de outro evento/dia.
    const local = lista.find((p) => p.pessoa_token === code || p.id === code);
    if (local) return credenciarPessoa(local);

    const r = await api.resolver(eventoId, code);
    if (r.status !== 200) {
      beepErr();
      if (r.status === 409) {
        const onde = (r.eventos || []).map((id) => (eventos.find((e) => e.id === id) || {}).nome || id).join(', ');
        // Destino para credenciar em um toque: prioriza o evento com a data de hoje
        // (pessoa nos dois dias da clínica -> escolhe o dia certo), senão um ativo.
        const hoje = new Date().toLocaleDateString('sv-SE'); // yyyy-mm-dd local
        const cands = (r.eventos || []).map((id) => eventos.find((e) => e.id === id)).filter((e) => e && !e.arquivado);
        const destino = cands.find((e) => e.data === hoje) || cands.find((e) => e.ativo) || cands[0];
        return {
          status: 'erro', titulo: 'QR de outro dia', nome: r.nome || 'Pessoa de outro evento',
          sub: `Pertence a: ${onde}.${destino ? '' : ' Selecione o dia correto.'}`,
          trocaEvento: destino ? { eventoId: destino.id, nome: destino.nome, code } : undefined,
        };
      }
      if (r.status === 0) {
        return {
          status: 'erro', titulo: 'Sem conexão', nome: 'Não deu para conferir este QR',
          sub: 'Busque a pessoa por nome ou CPF aqui embaixo — a lista do dia funciona sem internet.',
          naoReconhecido: true,
        };
      }
      return { status: 'erro', nome: 'QR não reconhecido', sub: 'Use a busca abaixo (nome ou CPF) para credenciar.', naoReconhecido: true };
    }
    return credenciarPessoa(r);
  }

  // "Credenciar em [evento]" no card de erro: troca o evento ativo e credencia direto.
  async function trocarECredenciar({ eventoId: novoId, code }) {
    setEventoId(novoId);
    const r = await api.resolver(novoId, code);
    if (r.status === 200) return credenciarPessoa(r);
    beepErr();
    return { status: 'erro', nome: 'Não foi possível credenciar no outro evento' };
  }

  // Walk-in pelo scanner: cadastra o mínimo (nome + tipo) e já credencia.
  // NÃO entra na fila offline de propósito: quem gera o id/pessoa_token é o servidor,
  // então um cadastro "otimista" sem resposta viraria pessoa duplicada quando a rede
  // voltasse. Falhou = o operador é avisado na hora e não libera a entrada.
  async function cadastrarRapido({ nome, tipo }) {
    let criado;
    try {
      criado = await api.criar({ nome, tipo, evento_id: eventoId });
    } catch (e) {
      beepErr();
      const offline = !navigator.onLine || e?.code === 'network';
      return {
        status: 'erro',
        titulo: offline ? 'Sem internet — NÃO cadastrou' : 'Não deu para cadastrar',
        nome,
        sub: offline
          ? 'Anote o nome no papel e cadastre quando a internet voltar. NÃO libere a entrada ainda.'
          : 'Tente de novo em alguns segundos. Se continuar falhando, anote o nome no papel e siga a fila.',
      };
    }
    qc.invalidateQueries({ queryKey: ['participantes', eventoId] });
    qc.invalidateQueries({ queryKey: ['eventos'] });
    return credenciarPessoa(criado);
  }

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand">
            <img className="brand-logo" src="/thb-logo.png" alt="Time Holding Brasil" />
            <div>
              <h1>Credenciamento THB</h1>
              <p>Time Holding Brasil</p>
            </div>
          </div>
          <div className="header-actions">
            {!readOnly && (
              <button className="btn primary" onClick={() => setScanOpen(true)} title="Ler QR do crachá">
                <IconQr /> Escanear QR Code
              </button>
            )}
            {!readOnly && (
              <button className="btn" onClick={() => { setNovoNome(''); setEditando(null); }}>
                <IconPlus /> Novo participante
              </button>
            )}

            <div className="mais-wrap" ref={maisRef}>
              <button className={`btn ghost ${maisOpen ? 'active' : ''}`} onClick={() => setMaisOpen((v) => !v)}
                title="Mais ações" aria-haspopup="true" aria-expanded={maisOpen}>
                <IconMore /> Mais ações
              </button>
              {maisOpen && (
                <div className="mais-menu" role="menu">
                  {!readOnly && (
                    <button role="menuitem" onClick={() => { setMaisOpen(false); abrirImport(); }}>
                      <IconImport /> Importar
                    </button>
                  )}
                  <button role="menuitem" onClick={() => { setMaisOpen(false); exportar(); }}>
                    <IconExport /> Exportar Excel
                  </button>
                  <button role="menuitem" onClick={() => { setMaisOpen(false); setHistOpen(true); }}>
                    <IconReset /> Histórico
                  </button>
                  <div className="mais-sep" />
                  <button role="menuitem" onClick={() => { setMaisOpen(false); setSettingsOpen(true); }}>
                    <IconSettings /> Configurações
                  </button>
                </div>
              )}
            </div>

            <span className="op-chip"><span className="who">{operador}</span>
              <button className="logout" title="Sair" onClick={onLogout}><IconLogout /></button></span>
          </div>
        </div>
      </header>

      <EventBar eventos={eventos} eventoId={eventoId} onSelect={setEventoId} hoje={hojeISO()} />

      <nav className="view-nav">
        <button className={`view-tab ${view === 'lista' ? 'active' : ''}`} onClick={() => setView('lista')}>
          <IconQr /> Credenciamento
        </button>
        <button className={`view-tab ${view === 'dashboard' ? 'active' : ''}`} onClick={() => setView('dashboard')}>
          <IconChart /> Dashboard
        </button>
      </nav>

      {readOnly && (
        <div className="readonly-banner">
          Visualizando <strong>{eventoAtual?.nome}</strong> (histórico — somente leitura).
          <button className="btn ghost" onClick={() => {
            const ativo = eventoPadrao(eventos);
            if (ativo) setEventoId(ativo.id);
          }}>Voltar aos eventos ativos</button>
        </div>
      )}

      {diaErrado && (
        <div className="dia-errado-banner">
          <span>Atenção: você está na lista de <strong>{eventoAtual?.nome}</strong>, mas hoje é <strong>{eventoDeHoje.nome}</strong>.</span>
          <button className="btn primary" onClick={() => setEventoId(eventoDeHoje.id)}>
            Ir para {eventoDeHoje.nome}
          </button>
        </div>
      )}

      {(!online || pendentes > 0) && (
        <div className="offline-banner">
          {!online && <span>⚠ Sem conexão — credenciamentos ficam salvos no aparelho.</span>}
          {pendentes > 0 && <span> {pendentes} pendente(s) de sincronização.</span>}
        </div>
      )}

      {view === 'dashboard' && (
        <DashboardModal eventoId={eventoId} eventoNome={eventoAtual?.nome || ''} lista={lista} />
      )}

      {view === 'lista' && (<>
      <section className="summary">
        <div className="summary-card">
          <div className="summary-head">
            <div className="summary-title">
              <span className="summary-evento">{eventoAtual?.nome || '—'}</span>
              <span className={`sync-dot ${sync.k}`}><span className="dot" />{sync.t}</span>
            </div>
            <div className="summary-pct">{pct}<span>%</span></div>
          </div>

          <div className="summary-progress">
            <div className="summary-bar"><div className="summary-fill" style={{ width: `${pct}%` }} /></div>
            <div className="summary-progress-label">
              <strong>{cred}</strong> de <strong>{total}</strong> credenciados
            </div>
          </div>

          <div className="summary-metrics">
            <div className="summary-metric">
              <span className="sm-label">Total na lista</span>
              <span className="sm-value">{total}</span>
            </div>
            <div className="summary-metric ok">
              <span className="sm-label">Credenciados</span>
              <span className="sm-value">{cred}</span>
            </div>
            <div className="summary-metric warn">
              <span className="sm-label">Pendentes</span>
              <span className="sm-value">{pend}</span>
            </div>
            <div className="summary-metric acc">
              <span className="sm-label">Última hora</span>
              <span className="sm-value">{ultimaHora}</span>
            </div>
          </div>
        </div>
      </section>

      <div className="toolbar">
        <div className="search">
          <IconSearch />
          <input ref={searchRef} value={busca} onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !readOnly && filtrada.length === 1) {
                const alvo = filtrada[0];
                if (!alvo.credenciado) credenciarMut.mutate({ id: alvo.id, credenciado: true, nome: alvo.nome });
              }
            }}
            placeholder="Buscar por nome, e-mail, telefone, turma ou convidador…" autoComplete="off" />
          {busca
            ? <button className="search-clear" title="Limpar busca" onClick={() => { setBusca(''); searchRef.current?.focus(); }}><IconClose /></button>
            : <kbd className="search-kbd">/</kbd>}
        </div>

        <div className="filter">
          {[['todos', 'Todos', total], ['pendentes', 'Pendentes', pend], ['credenciados', 'Credenciados', cred]].map(([f, label, n]) => (
            <button key={f} className={filtro === f ? 'active' : ''} onClick={() => setFiltro(f)}>
              {label}<span className="filter-count">{n}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar-sub">
        <select className="ctl" value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value)}>
          <option value="todos">Tipo: Todos</option>
          <option value="comprador">Comprador</option>
          <option value="convidado">Convidado</option>
        </select>
        <select className="ctl" value={ingressoFiltro} onChange={(e) => setIngressoFiltro(e.target.value)}>
          <option value="todos">Ingresso: Todos</option>
          <option value="DIAMOND">Diamond</option>
          <option value="VIP">VIP</option>
          <option value="PLATEIA">Plateia</option>
          <option value="diamante">Diamante (convidado)</option>
        </select>
        <select className="ctl" value={compradorFiltro} onChange={(e) => setCompradorFiltro(e.target.value)}>
          <option value="todos">Poss. comprador: Todos</option>
          <option value="sim">Possível comprador</option>
          <option value="nao">Não é</option>
        </select>
        <select className="ctl" value={ordem} onChange={(e) => setOrdem(e.target.value)}>
          <option value="nome">Ordenar: Nome (A→Z)</option>
          <option value="nome-desc">Nome (Z→A)</option>
          <option value="turma">Turma</option>
          <option value="tipo">Tipo</option>
          <option value="credenciado-first">Credenciados primeiro</option>
          <option value="pendente-first">Pendentes primeiro</option>
        </select>
        <button className={`ctl ${filtrosOpen || filtros.length ? 'on' : ''}`} onClick={() => setFiltrosOpen((v) => !v)}>
          Filtros avançados{filtros.length ? ` (${filtros.length})` : ''}
        </button>
      </div>

      {filtrosOpen && (
        <div className="filtros-av">
          <select value={novoCol} onChange={(e) => setNovoCol(e.target.value)}>
            <option value="">+ Filtrar por coluna…</option>
            {colunas.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {novoCol && (
            <select value="" onChange={(e) => { if (e.target.value) { addFiltro(novoCol, e.target.value); setNovoCol(''); } }}>
              <option value="">Escolha o valor…</option>
              {valoresDe(novoCol).map((v) => <option key={v.key} value={v.key}>{v.label} ({v.count})</option>)}
            </select>
          )}
          <span className="filtros-hint">Escolha a coluna e o valor (sem digitar). Empilhe filtros para cruzar dados.</span>
        </div>
      )}

      {filtros.length > 0 && (
        <div className="filtros-chips">
          {filtros.map((f, i) => (
            <span className="filtro-chip" key={`${f.col}-${f.key}`}>
              <b>{f.col}</b>: {f.label}
              <button onClick={() => setFiltros(filtros.filter((_, j) => j !== i))} title="Remover">×</button>
            </span>
          ))}
          <button className="btn ghost" onClick={() => setFiltros([])}>Limpar tudo</button>
        </div>
      )}

      <main className="list-wrap">
        <div className="count-row">
          <span>{filtrada.length} {filtrada.length === 1 ? 'participante' : 'participantes'}{filtro !== 'todos' ? ` · ${filtro}` : ''}</span>
        </div>
        <div className="table-wrap">
          <div className="table-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 150 }}>Status</th>
                  <th>Participante</th>
                  <th className="hide-sm" style={{ width: 160 }}>Tipo / Categoria</th>
                  <th className="hide-sm">Informações</th>
                  <th style={{ textAlign: 'right', width: 92 }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((p) => (
                  <Linha key={p.id} p={p} readOnly={readOnly}
                    onToggle={onToggleLinha}
                    onEdit={onEditLinha}
                    onDetail={onDetailLinha} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {filtrada.length > visiveis.length && (
          <div className="show-more">
            <button className="btn" onClick={() => setLimite((l) => l + 500)}>
              Mostrar mais ({filtrada.length - visiveis.length} restantes)
            </button>
          </div>
        )}
        {!isLoading && filtrada.length === 0 && (
          <div className="empty">
            <IconSearch />
            <div>Nenhum participante encontrado{busca ? ` para "${busca}"` : ''}.</div>
            {busca.trim() && !readOnly && (
              <button className="btn primary" style={{ marginTop: 14 }} onClick={() => { setNovoNome(busca.trim()); setEditando(null); }}>
                <IconPlus /> Cadastrar "{busca.trim()}" neste evento
              </button>
            )}
          </div>
        )}
      </main>
      </>)}

      <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onImportFile} />

      {editando !== undefined && (
        <ParticipantModal participant={editando} eventoId={eventoId} nomeInicial={novoNome} onClose={() => setEditando(undefined)} />
      )}
      {detalheId && (
        <DetailModal participantId={detalheId}
          eventos={eventos}
          readOnly={readOnly}
          onClose={() => setDetalheId(null)}
          onEdit={readOnly ? null : (p) => { setDetalheId(null); setEditando(p); }}
          onCredenciar={readOnly ? null : (id, novo, nome) => credenciarMut.mutateAsync({ id, credenciado: novo, nome })}
          onMarcarComprador={readOnly ? null : marcarComprador}
          onOpenByName={(nome) => {
            const alvo = norm(nome);
            const achado = lista.find((x) => norm(x.nome) === alvo) || lista.find((x) => norm(x.nome).includes(alvo));
            if (achado) setDetalheId(achado.id);
            else toast('Essa pessoa não está nesta lista do evento.', 'danger');
          }} />
      )}
      {histOpen && (
        <HistoryModal eventos={eventos} onClose={() => setHistOpen(false)}
          onOpen={(id) => { setEventoId(id); setHistOpen(false); }} />
      )}
      {scanOpen && (
        <ScannerModal onDetected={aoEscanear} onManual={credenciarPessoa}
          onUndo={(id, nome) => credenciarMut.mutate({ id, credenciado: false, nome })}
          onTrocarEvento={trocarECredenciar}
          onQuickAdd={cadastrarRapido}
          onMarcarComprador={marcarComprador}
          pendentes={pendentes} online={online}
          diaErrado={diaErrado} nomeDeHoje={eventoDeHoje?.nome || ''}
          onIrParaHoje={eventoDeHoje ? () => setEventoId(eventoDeHoje.id) : null}
          lista={lista} eventoNome={eventoAtual?.nome || ''} onClose={() => setScanOpen(false)} />
      )}
      {settingsOpen && <SettingsModal eventos={eventos} onClose={() => setSettingsOpen(false)} />}
    </>
  );
}

// memo + callbacks estáveis: com o structural sharing do react-query, um poll sem
// mudanças mantém as mesmas referências e nenhuma linha re-renderiza.
const Linha = memo(function Linha({ p, readOnly, onToggle, onEdit, onDetail }) {
  const telClean = (p.telefone || '').replace(/\D/g, '');
  const grupoSim = p.grupo && /^sim/i.test(String(p.grupo).trim());
  const grupoNao = p.grupo && /^n[ãa]o/i.test(String(p.grupo).trim());
  const temInfo = p.turma || p.tamanhoCamisa || p.grupo || p.instrucao;
  return (
    <tr className={p.credenciado ? 'credenciado' : ''}>
      <td>
        <button className={`check-btn ${p.credenciado ? 'on' : ''}`} onClick={() => onToggle(p)} disabled={readOnly}>
          {p.credenciado ? <><IconCheck /> Credenciado</> : <><IconSquare /> Credenciar</>}
        </button>
      </td>
      <td>
        <div className="cell-nome">
          <div className={`avatar avatar-${tipoCls(p.tipo)}`}>{initials(p.nome)}</div>
          <div className="name-wrap">
            <div className="name">
              <button type="button" className="name-btn" onClick={() => onDetail(p)}>{p.nome || '—'}</button>
            </div>
            {(p.nomeCracha || p.profissao || p.convidadoPor) && (
              <div className="name-sub">
                {[p.nomeCracha, p.profissao, p.convidadoPor ? `convidado por ${p.convidadoPor}` : '']
                  .filter(Boolean).join(' · ')}
              </div>
            )}
            <div className="name-contact">
              {p.telefone && <a href={`https://wa.me/${telClean}`} target="_blank" rel="noopener noreferrer">{p.telefone}</a>}
              {p.email && <span className="nc-mail">{p.email}</span>}
            </div>
            <div className="name-tags">
              <span className={`tbadge tbadge-${tipoCls(p.tipo)}`}>{tipoLabel(p.tipo)}</span>
              {p.turma && <span className="badge turma">{p.turma}</span>}
              {p.tamanhoCamisa && <span className="badge size">{p.tamanhoCamisa}</span>}
              {p.grupo && grupoBadge(p.grupo)}
              {p.representante && (p.representante.nome || p.representante.email) && (
                <span className="badge rep" title={`Representante: ${p.representante.nome || ''}${p.representante.email ? ' · ' + p.representante.email : ''}`}>
                  Repr.: {p.representante.nome || p.representante.email}
                </span>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="hide-sm">
        <span className={`tbadge tbadge-${tipoCls(p.tipo)}`}>{tipoLabel(p.tipo)}</span>
        {p.grupoDiamante && <div className="grupo-dia">{p.grupoDiamante}</div>}
      </td>
      <td className="hide-sm">
        {temInfo ? (
          <div className="info-cell">
            {p.turma && <span className="badge turma">{p.turma}</span>}
            {p.tamanhoCamisa && <span className="badge size" title="Tamanho da camisa">{p.tamanhoCamisa}</span>}
            {p.grupo && <span className={`gbadge ${grupoSim ? 'gsim' : grupoNao ? 'gnao' : ''}`} title="Grupo">{grupoSim ? 'No grupo' : grupoNao ? 'Fora do grupo' : String(p.grupo)}</span>}
            {p.instrucao && <span className="badge inst">{p.instrucao}</span>}
          </div>
        ) : <span className="info-empty">—</span>}
      </td>
      <td>
        <div className="actions-cell">
          <button className="icon-btn" onClick={() => onDetail(p)} title="Ver detalhes"><IconSearch /></button>
          {!readOnly && <button className="icon-btn" onClick={() => onEdit(p)} title="Editar"><IconEdit /></button>}
        </div>
      </td>
    </tr>
  );
});
