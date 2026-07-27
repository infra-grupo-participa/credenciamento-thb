import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { useToast } from './Toasts.jsx';
import { IconClose } from '../icons.jsx';

export default function SettingsModal({ eventos, onClose }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [aba, setAba] = useState('eventos');

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-lg" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>Configurações</h3>
          <button className="icon-btn" onClick={onClose} title="Fechar"><IconClose /></button>
        </div>
        <div className="modal-body">
          <div className="tabs">
            <button className={aba === 'eventos' ? 'active' : ''} onClick={() => setAba('eventos')}>Eventos</button>
            <button className={aba === 'importar' ? 'active' : ''} onClick={() => setAba('importar')}>Importar lista</button>
            <button className={aba === 'operadores' ? 'active' : ''} onClick={() => setAba('operadores')}>Operadores</button>
            <button className={aba === 'senha' ? 'active' : ''} onClick={() => setAba('senha')}>Senha</button>
          </div>
          {aba === 'eventos' && <AbaEventos eventos={eventos} qc={qc} toast={toast} />}
          {aba === 'importar' && <AbaImportar eventos={eventos} qc={qc} toast={toast} />}
          {aba === 'operadores' && <AbaOperadores toast={toast} />}
          {aba === 'senha' && <AbaSenha toast={toast} />}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn primary" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

function AbaEventos({ eventos, qc, toast }) {
  const [novo, setNovo] = useState({ nome: '', tipo: 'clinica', data: '', ordem: '', dias: 1 });
  const [salvando, setSalvando] = useState('');

  async function salvar(ev, campos) {
    setSalvando(ev.id);
    try { await api.atualizarEvento(ev.id, campos); await qc.invalidateQueries({ queryKey: ['eventos'] }); toast('Evento atualizado', 'success'); }
    catch { toast('Erro ao salvar evento', 'danger'); }
    finally { setSalvando(''); }
  }
  async function criar() {
    const nome = novo.nome.trim();
    if (!nome) { toast('Informe o nome do evento', 'danger'); return; }
    const dias = Math.max(1, Math.min(10, Number(novo.dias) || 1));
    const ord0 = Number(novo.ordem) || eventos.length;
    setSalvando('novo');
    try {
      if (dias === 1) {
        await api.criarEvento({ nome, tipo: novo.tipo, data: novo.data, ordem: ord0 });
      } else {
        // Vários dias = mesmo QR nos dias: ids "base-d1..base-dN" (o grupo do QR é a "base").
        const slug = nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
        const base = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
        for (let i = 1; i <= dias; i++) {
          let data = novo.data || '';
          if (data) { const d = new Date(`${data}T00:00:00`); d.setDate(d.getDate() + (i - 1)); data = d.toISOString().slice(0, 10); }
          await api.criarEvento({ id: `${base}-d${i}`, nome: `${nome} — Dia ${i}`, tipo: novo.tipo, data, ordem: ord0 + (i - 1) });
        }
      }
      await qc.invalidateQueries({ queryKey: ['eventos'] });
      setNovo({ nome: '', tipo: 'clinica', data: '', ordem: '', dias: 1 });
      toast(dias > 1 ? `Evento de ${dias} dias criado (mesmo QR nos dias)` : 'Evento criado', 'success');
    } catch { toast('Erro ao criar evento', 'danger'); }
    finally { setSalvando(''); }
  }

  return (
    <div>
      {[...eventos].sort((a, b) => a.ordem - b.ordem).map((e) => <LinhaEvento key={e.id} ev={e} onSalvar={salvar} salvando={salvando === e.id} />)}
      <div className="detail-section">Novo evento</div>
      <div className="ev-form">
        <input placeholder="Nome (ex: Encontro de Diamantes)" value={novo.nome} onChange={(ev) => setNovo({ ...novo, nome: ev.target.value })} />
        <select value={novo.tipo} onChange={(ev) => setNovo({ ...novo, tipo: ev.target.value })}>
          <option value="imersao">Imersão</option>
          <option value="clinica">Clínica</option>
          <option value="passado">Passado</option>
        </select>
        <input type="date" value={novo.data} onChange={(ev) => setNovo({ ...novo, data: ev.target.value })} title="Data (1º dia)" />
        <select value={novo.dias} onChange={(ev) => setNovo({ ...novo, dias: Number(ev.target.value) })} title="Quantos dias">
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} dia{n > 1 ? 's' : ''}</option>)}
        </select>
        <input style={{ width: 70 }} placeholder="ordem" value={novo.ordem} onChange={(ev) => setNovo({ ...novo, ordem: ev.target.value })} />
        <button className="btn primary" onClick={criar} disabled={salvando === 'novo'}>Criar</button>
      </div>
      <p className="cfg-title">Com 2+ dias, cada dia é criado separado (check-in por dia) e a data avança automaticamente — o <b>mesmo QR de cada pessoa vale em todos os dias</b>.</p>
    </div>
  );
}

function LinhaEvento({ ev, onSalvar, salvando }) {
  const [f, setF] = useState({ nome: ev.nome, data: ev.data || '', ordem: ev.ordem, ativo: ev.ativo, arquivado: ev.arquivado });
  return (
    <div className="ev-row">
      <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
      <input type="date" value={f.data || ''} onChange={(e) => setF({ ...f, data: e.target.value })} />
      <input style={{ width: 56 }} value={f.ordem} onChange={(e) => setF({ ...f, ordem: Number(e.target.value) || 0 })} title="Ordem" />
      <label className="ev-chk"><input type="checkbox" checked={!!f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Ativo</label>
      <label className="ev-chk"><input type="checkbox" checked={!!f.arquivado} onChange={(e) => setF({ ...f, arquivado: e.target.checked })} /> Histórico</label>
      <button className="btn mini" onClick={() => onSalvar(ev, f)} disabled={salvando}>Salvar</button>
    </div>
  );
}

const normH = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
function mapearColunas(headers) {
  const acha = (...alvos) => {
    for (const a of alvos) { const h = headers.find((x) => normH(x) === a); if (h) return h; }
    for (const a of alvos) { const h = headers.find((x) => normH(x).includes(a)); if (h) return h; }
    return undefined;
  };
  return {
    nome: acha('nome completo', 'nome'),
    email: acha('e-mail', 'email'),
    telefone: acha('telefone (whatsapp)', 'telefone', 'whatsapp', 'celular'),
    documento: acha('documento', 'cpf', 'cnpj'),
    cidade: acha('cidade'), estado: acha('estado', 'uf'),
    turma: acha('turma'), profissao: acha('profissao'),
    instrucao: acha('instrucao'), tipo: acha('tipo'),
    nivel: acha('nivel'), faturamento: acha('faturamento'),
    tamanhoCamisa: acha('nome do cracha') ? undefined : acha('camisa', 'tamanho'),
    nomeCracha: acha('nome do cracha', 'cracha'),
    convidadoPor: acha('pessoa que indicou', 'quem convidou', 'quem indicou', 'convidado por', 'nome do socio', 'indicou'),
    // Ingresso/Categoria (formato consolidado THB) alimentam o grupoDiamante:
    // DIAMOND/VIP/PLATEIA e afins. Mantém 'qual e o seu grupo' das planilhas antigas.
    grupoDiamante: acha('qual e o seu grupo', 'ingresso', 'categoria'),
    grupo: acha('entrou no grupo', 'esta no grupo da imersao', 'esta no grupo', 'no grupo'),
  };
}
function montarLinhas(json, map) {
  const get = (r, k) => (map[k] ? r[map[k]] : '');
  return json.map((r) => {
    const instr = get(r, 'instrucao'); const conv = get(r, 'convidadoPor');
    let tipo = String(get(r, 'tipo') || '').toLowerCase();
    if (!['comum', 'socio', 'diamante', 'convidado'].includes(tipo)) {
      // Junta os sinais de tipo: Instrução (planilhas antigas) + Ingresso/Categoria/Origem
      // (formato consolidado). Ex.: DIAMANTE, THB-SÓCIO, PLATEIA/DIAMOND/VIP.
      const i = [instr, get(r, 'grupoDiamante'), r.Categoria, r.categoria, r.Origem, r.origem]
        .map((x) => String(x || '').toUpperCase()).join(' ');
      tipo = /DIAMANTE|DIAMOND|DIAMANTES/.test(i) ? 'diamante'
        : /S[ÓO]CIO/.test(i) ? 'socio'
          : (conv && String(conv).trim()) ? 'convidado' : 'comum';
    }
    return {
      nome: get(r, 'nome'), email: get(r, 'email'), telefone: String(get(r, 'telefone') || ''),
      documento: get(r, 'documento'), cidade: get(r, 'cidade'), estado: get(r, 'estado'),
      turma: get(r, 'turma'), profissao: get(r, 'profissao'), instrucao: instr,
      nivel: get(r, 'nivel'), faturamento: get(r, 'faturamento'), tamanhoCamisa: get(r, 'tamanhoCamisa'),
      nomeCracha: get(r, 'nomeCracha'), convidadoPor: conv ? String(conv) : '', grupoDiamante: get(r, 'grupoDiamante'),
      grupo: get(r, 'grupo'), tipo, dados_extra: r,
    };
  }).filter((x) => String(x.nome || '').trim());
}

const COLUNAS_TEMPLATE = ['Nome', 'Documento', 'Email', 'Telefone', 'Ingresso', 'Categoria', 'Turma', 'Origem', 'Observacao'];

// Gera e baixa o modelo XLSX que o operador preenche e exporta como CSV/Excel.
async function baixarTemplate() {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const exemplo = [{
    Nome: 'Maria Exemplo da Silva', Documento: '123.456.789-00', Email: 'maria@exemplo.com',
    Telefone: '(11) 99999-0000', Ingresso: 'PLATEIA', Categoria: 'Comprador', Turma: '',
    Origem: 'Compradores', Observacao: '',
  }];
  const ws = XLSX.utils.json_to_sheet(exemplo, { header: COLUNAS_TEMPLATE });
  ws['!cols'] = COLUNAS_TEMPLATE.map((c) => ({ wch: Math.max(14, c.length + 2) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Participantes');
  const inst = XLSX.utils.aoa_to_sheet([
    ['Como preencher a lista de credenciamento'],
    [''],
    ['1. Preencha uma linha por pessoa na aba "Participantes".'],
    ['2. Nome é obrigatório. Email é a chave que evita duplicatas — preencha sempre que tiver.'],
    ['3. Documento: CPF ou CNPJ (pode repetir entre sócios — o sistema trata pelo email).'],
    ['4. Ingresso/Categoria: DIAMOND, VIP, PLATEIA, SÓCIO, DIAMANTE… (define o tipo do crachá).'],
    ['5. Origem: de qual lista veio (Compradores, Diamantes, Renovações…). Livre.'],
    ['6. Pode reenviar o mesmo arquivo com gente a mais quantas vezes quiser:'],
    ['   no modo "Sincronizar" o sistema NÃO duplica e NÃO apaga quem já foi credenciado.'],
    ['7. Salve/Exporte como CSV (UTF-8) ou XLSX e envie na aba "Importar lista".'],
    [''],
    ['Não renomeie nem remova as colunas da aba "Participantes".'],
  ]);
  inst['!cols'] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(wb, inst, 'Instruções');
  XLSX.writeFile(wb, 'modelo-credenciamento-THB.xlsx');
}

function AbaImportar({ eventos, qc, toast }) {
  const [eventoSel, setEventoSel] = useState('');
  const [wb, setWb] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [sheetSel, setSheetSel] = useState('');
  const [linhas, setLinhas] = useState([]);
  const [modo, setModo] = useState('sincronizar');
  const [importando, setImportando] = useState(false);
  const [previa, setPrevia] = useState(null); // relatório do dry-run

  async function onFile(e) {
    const file = e.target.files && e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const w = XLSX.read(buf, { type: 'array' });
      setWb({ XLSX, w }); setSheets(w.SheetNames); const s = w.SheetNames[0]; setSheetSel(s);
      parse({ XLSX, w }, s);
    } catch { toast('Não consegui ler o arquivo', 'danger'); }
  }
  function parse(ctx, sheet) {
    const json = ctx.XLSX.utils.sheet_to_json(ctx.w.Sheets[sheet], { defval: '' });
    const headers = json.length ? Object.keys(json[0]) : [];
    setPrevia(null);
    setLinhas(montarLinhas(json, mapearColunas(headers)));
  }

  async function verPrevia() {
    if (!eventoSel) { toast('Escolha o evento de destino', 'danger'); return; }
    if (!linhas.length) { toast('Nada para conferir', 'danger'); return; }
    try {
      const r = await api.previaImportar(eventoSel, linhas);
      setPrevia(r.previa);
    } catch { toast('Não consegui gerar a prévia', 'danger'); }
  }

  async function importar() {
    if (!eventoSel) { toast('Escolha o evento de destino', 'danger'); return; }
    if (!linhas.length) { toast('Nada para importar', 'danger'); return; }
    const ev = eventos.find((x) => x.id === eventoSel);
    const rotulo = modo === 'substituir' ? 'SUBSTITUIR (apaga tudo e recria)'
      : modo === 'adicionar' ? 'Adicionar/atualizar (não duplica)'
        : 'Sincronizar (não duplica, mantém credenciados)';
    if (!confirm(`${rotulo}\n\nEvento "${ev?.nome}" · ${linhas.length} pessoa(s). Confirmar?`)) return;
    setImportando(true);
    try {
      const r = await api.importar(eventoSel, linhas, modo);
      await qc.invalidateQueries({ queryKey: ['participantes', eventoSel] });
      await qc.invalidateQueries({ queryKey: ['eventos'] });
      const res = r.resultado || {};
      toast(`+${res.inseridos ?? r.count} novos · ~${res.atualizados ?? 0} atualizados`, 'success');
      setLinhas([]); setWb(null); setSheets([]); setPrevia(null);
    } catch { toast('Erro ao importar', 'danger'); }
    finally { setImportando(false); }
  }

  return (
    <div>
      <p className="cfg-title">
        Carregue um CSV ou Excel (com cabeçalho). As colunas comuns são detectadas automaticamente
        (nome, e-mail, telefone, ingresso/categoria, turma, quem convidou…).
        {' '}<a href="#" onClick={(e) => { e.preventDefault(); baixarTemplate().catch(() => toast('Erro ao gerar o modelo', 'danger')); }}>Baixar modelo (XLSX)</a>
      </p>
      <div className="ev-form">
        <select value={eventoSel} onChange={(e) => { setEventoSel(e.target.value); setPrevia(null); }}>
          <option value="">Evento de destino…</option>
          {eventos.filter((e) => !e.arquivado).map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
        <label className="btn">Escolher arquivo<input type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={onFile} /></label>
        {sheets.length > 1 && (
          <select value={sheetSel} onChange={(e) => { setSheetSel(e.target.value); parse(wb, e.target.value); }}>
            {sheets.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>
      {linhas.length > 0 && (
        <>
          <div className="detail-section">Arquivo — {linhas.length} pessoa(s)</div>
          <div className="kvs">
            {linhas.slice(0, 5).map((p, i) => <div key={i} className="kv"><span className="kv-k">{p.nome}</span><span className="kv-v">{p.tipo}{p.turma ? ` · ${p.turma}` : ''}{p.convidadoPor ? ` · convidado por ${p.convidadoPor}` : ''}</span></div>)}
            {linhas.length > 5 && <div className="cfg-title">…e mais {linhas.length - 5}</div>}
          </div>

          <div className="ev-form" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            <label className="ev-chk"><input type="radio" checked={modo === 'sincronizar'} onChange={() => setModo('sincronizar')} /> Sincronizar (recomendado)</label>
            <label className="ev-chk"><input type="radio" checked={modo === 'adicionar'} onChange={() => setModo('adicionar')} /> Adicionar/atualizar</label>
            <label className="ev-chk"><input type="radio" checked={modo === 'substituir'} onChange={() => setModo('substituir')} /> Substituir tudo</label>
          </div>
          <p className="cfg-title">
            {modo === 'substituir'
              ? '⚠️ Apaga TODA a lista do evento e recria — perde credenciamento, fotos e representantes. Use só na carga inicial.'
              : 'Não duplica: reconhece a mesma pessoa pelo e-mail (ou documento/nome) e atualiza. Preserva quem já foi credenciado, fotos, representantes e o lote.'}
          </p>

          {previa && (
            <div className="kvs" style={{ marginTop: 6 }}>
              <div className="kv"><span className="kv-k">Novos a inserir</span><span className="kv-v">{previa.novos}</span></div>
              <div className="kv"><span className="kv-k">Já existem (atualizar)</span><span className="kv-v">{previa.atualizados}</span></div>
              <div className="kv"><span className="kv-k">No banco, fora do arquivo</span><span className="kv-v">{previa.orfaos} (mantidos)</span></div>
              {previa.duplicatasArquivo && previa.duplicatasArquivo.length > 0 && (
                <div className="kv"><span className="kv-k">Repetidos no arquivo</span><span className="kv-v">{previa.duplicatasArquivo.length} (serão fundidos)</span></div>
              )}
            </div>
          )}

          <div className="ev-form" style={{ marginTop: 10 }}>
            <button className="btn" onClick={verPrevia} disabled={importando}>Conferir antes</button>
            <button className="btn primary" onClick={importar} disabled={importando}>{importando ? 'Importando…' : 'Importar'}</button>
          </div>
        </>
      )}
    </div>
  );
}

function AbaOperadores({ toast }) {
  const [lista, setLista] = useState(null);
  const [nome, setNome] = useState('');
  useEffect(() => { api.getConfig('operadores').then((r) => setLista(Array.isArray(r.v) ? r.v : [])).catch(() => setLista([])); }, []);
  async function gravar(novaLista) {
    setLista(novaLista);
    try { await api.setConfig('operadores', novaLista); } catch { toast('Erro ao salvar operadores', 'danger'); }
  }
  if (lista === null) return <div className="center-screen" style={{ minHeight: 100 }}><div className="spinner" /></div>;
  return (
    <div>
      <p className="cfg-title">Operadores aparecem como sugestão na tela de login.</p>
      <div className="op-list">
        {lista.map((n) => (
          <span className="op-tag" key={n}>{n}<button onClick={() => gravar(lista.filter((x) => x !== n))} title="Remover">×</button></span>
        ))}
        {lista.length === 0 && <span className="cfg-title">Nenhum operador cadastrado.</span>}
      </div>
      <div className="ev-form" style={{ marginTop: 10 }}>
        <input placeholder="Nome do operador" value={nome} onChange={(e) => setNome(e.target.value)} />
        <button className="btn primary" onClick={() => { const n = nome.trim(); if (n && !lista.includes(n)) { gravar([...lista, n]); setNome(''); } }}>Adicionar</button>
      </div>
    </div>
  );
}

function AbaSenha({ toast }) {
  const [s1, setS1] = useState(''); const [s2, setS2] = useState(''); const [salvando, setSalvando] = useState(false);
  async function salvar() {
    if (s1.length < 4) { toast('A senha precisa de pelo menos 4 caracteres', 'danger'); return; }
    if (s1 !== s2) { toast('As senhas não conferem', 'danger'); return; }
    setSalvando(true);
    try { await api.trocarSenha(s1); toast('Senha do evento atualizada', 'success'); setS1(''); setS2(''); }
    catch { toast('Erro ao trocar a senha', 'danger'); }
    finally { setSalvando(false); }
  }
  return (
    <div>
      <p className="cfg-title">Define a senha que todos os operadores usam para entrar (vale imediatamente para novos logins).</p>
      <div className="field"><label>Nova senha</label><input type="password" value={s1} onChange={(e) => setS1(e.target.value)} /></div>
      <div className="field"><label>Confirmar senha</label><input type="password" value={s2} onChange={(e) => setS2(e.target.value)} /></div>
      <button className="btn primary" onClick={salvar} disabled={salvando}>Salvar nova senha</button>
    </div>
  );
}
