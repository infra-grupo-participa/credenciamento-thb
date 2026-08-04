# Tarefa: Deixar o credenciamento redondo para o dia D — ETHB SP (04-06/08/2026)

Evento: 3 dias independentes (`ethb-sp-d1`, `ethb-sp-d2`, `ethb-sp-d3`), 361 pessoas por dia,
1.083 linhas, QR único válido nos 3 dias. Amanhã (04/08) é o dia 1.

## Orquestrador — verificação de QR Codes (CONCLUÍDA, 03/08)

Recalculei os 1.083 tokens direto no Postgres com a fórmula atual de `db.js:tokenDe()`
(`sha1("ethb-sp|" || chave)[:24]`, chave = documento só-dígitos > email > nome):

- **1.074/1.083 batem byte a byte = 99,17%**
- 9 divergentes = **3 pessoas × 3 dias**, TODAS explicadas (9/9) por override deliberado
  derivando do e-mail em vez do documento — são sócios que dividem CNPJ
  (Amarílis R. de Aquino, Emerson K. Teruya, Marisa E. Tiedt). Ver `dados-uteis/cadastrar-lote5.js:8-10`.
  **Não são QR quebrados** — resolvem normalmente, só não seguem a fórmula padrão.
- `grupoDe()` e `tokenDe()` **não foram tocados** pelos 9 commits novos (`git diff fac807b..HEAD -- db.js`).
- Testes que importam de verdade:
  - tokens ambíguos (1 QR → 2 pessoas no mesmo dia): **0**
  - pessoas sem os 3 dias: **0**
  - token instável entre dias: só 4 e-mails, e 3 são casais/sócios dividindo e-mail (correto)

**VEREDITO: 100% dos QR distribuídos resolvem. Nenhum QR foi invalidado pelas mudanças.**

### Ressalvas (baixo impacto, não bloqueiam)
- 2 pessoas duplicadas com 2 QR cada: `Sueli A. R. da Silva` (1 linha sem documento + 1 com;
  ids `...-1cc3587a1ad0fe629a89` e `...-2`) e `Osvaldo José Catena Junior` (2 e-mails, 2 docs
  — pode ser PF + PJ). Qualquer um dos 2 QR credencia; o registro irmão fica em aberto e
  infla a contagem de "não credenciados" em 2. Decidir na hora: credenciar o duplicado também.

## Orquestrador — outras verificações
- Build limpo (`npm run build`, vite 5.4.21, 181 módulos, 2.7s). Hashes gerados
  (`index-C7MPanu1.js` / `index-DM09Qgle.css`) **idênticos ao `dist/` commitado** → o build
  versionado que a Hostinger serve está em sincronia com o source. Nada a redeployar por isso.
- Card persistente: **já implementado**. `ScannerModal.jsx:87-100` (`mostrarResultado`) não tem
  auto-dismiss; `res` só troca no próximo QR ou no toque em "Continuar lendo" (linha 310).
- `npm install` no Windows: NÃO podou o lockfile desta vez (só adicionou `"peer": true`).
  Revertido junto com o `dist/` (que só diferia por CRLF). Árvore limpa.

## Orquestrador — dados e XLSX (03/08, prioridade do João)

### Reconciliação das 2 planilhas de origem
- `[CREDENCIAMENTO] Lista de Ingressos.xlsx` aba "Todos (361)" ↔ banco: **casamento perfeito**
  (0 faltando, 0 sobrando, lotes 327/15/1/3/5/10 batem exatamente).
- `[ETHB_2026 - SP] PLANILHA DE COMPRADORES...csv` (309 linhas): 5 não estavam no banco.
  4 deles são **representantes** (quem recebe o QR no lugar do participante) — padrão legítimo,
  há exatamente 5 relações de representante no evento: Mateus Tidre→Edson Luís Tidre,
  Josué B. Setenareski→Pedro Setenareski Filho, Jordana Doretto→Osvaldo Catena,
  Ana Julia L. Amaral→Osvaldo Catena, Iris N. R. da Silva→Sueli A. R. da Silva.
  O 5º era **EDSON RODRIGO MACIEL — genuinamente ausente**.

### Ações executadas no banco
1. **Inserido EDSON RODRIGO MACIEL** nos 3 dias, lote 6.
   `pessoa_token = 59b62bbef334cc4b83c7f1a7` (derivado do e-mail, sem documento no CSV).
   ids `ethb-sp-d{1,2,3}-cdd8345807267ecf4cce`. Link:
   `https://credenciamento.timeholdingbrasil.com.br/qr/59b62bbef334cc4b83c7f1a7`
   Verificado em produção: `/qr/` → HTTP 200 com o nome; `/qrimg/` → PNG 200.
2. **Backfill de Turma em 18 linhas** (6 pessoas × 3 dias): tinham `dados_extra.Turma`
   preenchido mas a COLUNA `turma` nula — e o export lê a coluna, então a Turma saía vazia
   no XLSX para essa gente (Amarílis T32, Célia T22, Iris T11, Lidiane T29, Rafael T26, Sérgio T16).

### XLSX regenerado
`C:\Users\João\Downloads\[CREDENCIAMENTO] Lista de Ingressos - ATUALIZADA.xlsx`
- Formato do modelo do João reproduzido: **18 colunas**, abas Lote 1–6 + "Todos (362)".
  (Atenção: NÃO é o formato de `src/exportRows.js`, que tem 29 colunas — o modelo é curado.)
- Mapeamento validado coluna a coluna contra o modelo: **0 divergências em 361 linhas**.
- Diff final vs. modelo: 362 pessoas, 0 sumiram, 1 novo (Edson), **0 QR alterados**,
  6 diferenças = só o backfill de Turma. 724/724 fórmulas `=IMAGE()` presentes.
- Regra de coluna descoberta: `Telefone` é SEMPRE o do participante, mesmo com representante
  (só o `E-mail` troca para o de disparo). Diverge de `exportRows.js:18`, que usaria o do
  representante — mantida a fidelidade ao modelo.
- **Armadilha do writer**: célula `{t:'s', f:'IMAGE(...)'}` SEM `v` é descartada na escrita e a
  fórmula some. Tem que ser `{t:'s', f:..., v:''}`. `src/exportRows.js:62` (`aplicarQrImagem`)
  tem exatamente esse defeito — o export do app provavelmente sai com a coluna QR vazia.
- Gerador: `scratchpad/gerar-xlsx.js` (reutilizável).

## PENDÊNCIAS que dependem do João
- `contato@goularte.adv.br` — comprou hoje à tarde, **não está em NENHUMA fonte** (nem CSV, nem
  XLSX, nem banco). Falta nome completo, telefone, ingresso e turma para cadastrar.
- Os 5 casos de representante: o crachá está no nome do PARTICIPANTE. Se o representante também
  for ao evento, ele não é achado por nome na busca do scanner. Confirmar quem realmente vai.
- Osvaldo José Catena Júnior tem **2 ingressos no próprio nome** (2 QR distintos), um para cada
  representante (Jordana e Ana Julia). Provável que os crachás devessem estar no nome delas.

## Mapeamento de autonomia do operador (Sonnet, 03/08) — TOP achados
João NÃO estará no evento e não há TI no local. A equipe precisa resolver tudo dentro do app.

1. **Senha do evento trocável sem confirmação** (`SettingsModal.jsx:337-355`) — maior raio de
   explosão: trocou, ninguém mais loga, e não há quem saiba a senha nova.
2. **Dia errado por padrão** (`App.jsx:131-136`) — o app abre no evento de menor `ordem`, não no
   de HOJE. Nos dias 2 e 3, aparelho novo/resetado abre no Dia 1 e credencia na lista errada.
3. **Walk-in não tem fila offline** (`App.jsx:434-439`) — único fluxo de cadastro dentro do
   scanner; se a rede cair, a pessoa se perde sem aviso.
4. **Excluir participante é irreversível** com `confirm()` fraco (`ParticipantModal.jsx:89-104`).
5. **Fila offline invisível dentro do Scanner** — o banner de "N pendentes" só existe na tela de
   lista (`App.jsx:517-522`), e o operador passa o evento inteiro dentro do modal do scanner.
6. **Sessão cai → tela de Login** sem avisar por quê (`api.js:49-53`); `/me` derruba sessão válida
   em QUALQUER erro, inclusive rede (`App.jsx:45`).
7. **Histórico/Auditoria mentem "vazio" quando falharam** (`DetailModal.jsx:79`, `DashboardModal.jsx:46`).
8. **Câmera bloqueada** — mensagem não ensina a resolver nem diz que a busca manual funciona.
9. **Duplicado usa o MESMO beep do sucesso** (`App.jsx:365`) — em salão barulhento passa batido.
10. **EventBar fica coberta pelo Scanner** (`styles.css:169`), mas o erro 409 manda "selecione o dia".

## Regras numéricas de design (pesquisa, 03/08)
- Alvo de toque: mínimo **48×48px**, primário **56-64px**, gap **≥8px** (Material 48dp + Apple HIG 44pt).
- Contraste: AA texto **4,5:1**, texto grande **3:1**, componentes/ícones **3:1**. Sob luz forte o
  contraste efetivo despenca → **mirar 7:1** nos estados críticos.
- Nunca comunicar estado só por cor (WCAG 1.4.1). Amarelo só como FUNDO sólido com texto escuro.
- Dado crítico (nome, status): **≥18px, semibold/bold**. Nada de leitura abaixo de 12px.
- Feedback: >1s exige spinner; >10s exige mensagem explícita (Nielsen).
- Throughput: QR ≈ **30s/pessoa** → ~120/hora por estação (Bizzabo). 362 pessoas numa janela de 1h
  pedem **3-4 estações simultâneas** — gargalo é operacional, não de UI.

## Problemas ABERTOS para o frontend (Opus)
1. **Mobile: card cobre o visor.** `styles.css:358-366` põe `.scan-result` como `position:absolute`
   ocupando `top/left/right` com `max-height:78vh` (linha 588). A câmera continua lendo por baixo
   (requisito do João atendido), mas o operador perde o visor para mirar o próximo QR. Precisa
   coexistir: card persiste E sobra visor utilizável.
2. **`quickTipo` default errado.** `ScannerModal.jsx:49` e `:133` usam `'comum'`, mas o ETHB só
   trabalha com `comprador`/`convidado` — e o filtro de Tipo da toolbar só oferece esses dois.
   Walk-in cadastrado como "comum" fica INVISÍVEL nos filtros do dia.
3. **`ParticipantModal.jsx:126-130`**: `<select>` de tipo não tem a opção "Comprador".

## Frontend — onda 1 (03/08) — robustez e autonomia

Escopo: só robustez/autonomia. `db.js`, `server.js`, `pessoa_token` e a máquina de leitura
(`BUSY_LOCK_MS` / `GAP_MS` / loop) **não foram tocados**. `styles.css` só recebeu um bloco
novo no fim do arquivo (nenhuma regra existente alterada) — a onda visual pode trabalhar sem
conflito.

### O que mudou (arquivo:linha)
1. **Dia certo por padrão** — `App.jsx:33-41` (`hojeISO`/`eventoPadrao`), `:166-173` (seleção
   inicial), `:575-578` ("Voltar aos eventos ativos"). Passa a preferir o evento com `data` =
   hoje; sem nenhum batendo, mantém o antigo (menor `ordem`).
   - `EventBar.jsx:8-45`: selo **HOJE** na aba do dia + `sr-only "(selecionado)"`.
   - **Extra (rede de segurança):** `App.jsx:177-179` + `:582-590` — banner vermelho
     "você está na lista de X, mas hoje é Y" com botão de troca em 1 toque. O mesmo aviso
     aparece DENTRO do scanner (`ScannerModal.jsx:342-349`), porque a EventBar fica coberta
     pelo modal.
2. **Trocar senha exige confirmação** — `SettingsModal.jsx:344-352` (`confirm()` explicando
   que vale para TODOS e que quem sair precisa da senha nova) + aviso no texto da aba (`:365`).
3. **Excluir participante** — `ParticipantModal.jsx:92-99`: confirmação forte (irreversível,
   apaga credenciamento/histórico, e sugere só desmarcar "Credenciado" se for esse o caso).
4. **Walk-in com rede de segurança** — `App.jsx:485-508`: `api.criar` em try/catch. Falhou =
   `beepErr` + card vermelho "Sem internet — NÃO cadastrou / Anote o nome no papel … NÃO libere
   a entrada ainda". `ScannerModal.jsx:138-152` mantém o nome digitado quando falha.
   **Escolha consciente: NÃO criei fila offline de cadastro** — quem gera `id`/`pessoa_token` é
   o servidor; um cadastro otimista viraria pessoa duplicada ao sincronizar. Aviso claro > walk-in
   duplicado (a fila de *credenciamento* continua intacta).
5. **Pendências visíveis no scanner** — `App.jsx:803` passa `pendentes`/`online`;
   `ScannerModal.jsx:327-333`: pílulas "N p/ enviar" e "Sem internet" no cabeçalho, somem
   quando zera. `styles.css` (bloco novo): no celular o cabeçalho quebra em 2 linhas, senão o
   "?" e o X saíam da tela.
6. **Sessão/boot resilientes** — `App.jsx:49-79`: `/me` só desloga em 401 (evento
   `chf:unauthorized`); erro de rede mantém a sessão, mostra banner e re-tenta a cada 5s.
   `Login.jsx:9,40`: novo prop `aviso` — "Sua sessão expirou… nada do que você credenciou foi
   perdido". `api.js` **não foi alterado**.
7. **Erro ≠ vazio** — `DetailModal.jsx:68,74-79,295-306` (histórico) e
   `DashboardModal.jsx:43-55,215-222` (auditoria): estados carregando/ok/erro + "Tentar de novo".
8. **Câmera bloqueada** — `ScannerModal.jsx:386-402`: passo a passo (cadeado → Câmera →
   Permitir → recarregar), diz em destaque que a busca manual continua funcionando, e botão
   "Tentar a câmera de novo" (48px) que remonta o `getUserMedia` (`getUserMedia` em `:177`, dep `[tentativaCam]` em `:232`).
   **Bug pré-existente corrigido junto:** com a câmera bloqueada o `.scan-result` nem era
   renderizado — credenciar pela busca manual não dava retorno NENHUM. O card foi extraído para
   `painelResultado` (`ScannerModal.jsx:239-316`, usado em `:404` e `:415`) e agora aparece nos dois cenários.
9. **Som de duplicado** — `beep.js:29` (`beepDup`: 440+440 Hz, vibração dupla) usado em
   `App.jsx:407`. Sucesso continua 880→1320 (subindo). Verificado no navegador.
10. **Ajuda offline no scanner** — botão "?" 48×48 (`ScannerModal.jsx:334-338`) abre painel de
    texto com os 5 casos (`:351-380`). Funciona sem internet.

Extra: `res.titulo` opcional no card (`ScannerModal.jsx:235`) — o 409 agora diz "QR de outro dia"
e o erro de rede diz "Sem conexão", em vez do genérico "QR não reconhecido".

### Verificação
`npm run build` OK (vite 5.4.21). Testado em navegador real (Playwright + API falsa em
`scratchpad/mock-api.js`), 360×740 / 390×844 / 1280×900, com 3 eventos onde o de HOJE é o de
MAIOR `ordem`:
- abre no Dia 3 (hoje) com selo HOJE; trocar para o Dia 1 dispara os 2 avisos e o botão volta;
- tons medidos: sucesso `[880,1320]`, duplicado `[440,440]`;
- walk-in offline → card vermelho + nome preservado no campo; pendências aparecem no cabeçalho;
- histórico/auditoria com 500 → bloco de erro + "Tentar de novo" recarrega;
- `/me` abortado no boot → segue logado com banner; 401 real → login com o motivo;
- câmera negada → tela com passo a passo + busca manual funcionando + card de resultado;
- 0 erros de JS no console (só os de rede provocados pelos testes).

### Para a ONDA VISUAL (medido, não fixei de propósito)
No celular, com o card persistente na tela, o `.scan-result` (`position:absolute`, `z-index:6`,
`max-height:78vh`) **cobre o campo de busca manual**: em 360×740, input em y=321 e o card indo de
y=135 a y=422 — `elementFromPoint` no centro do input devolve o botão do card. O operador precisa
tocar "Continuar lendo →" antes de buscar. Mitigação de texto já aplicada na ajuda ("toque em
Continuar lendo → para tirar o cartão da frente"), mas a solução é de layout — é o item 1 dos
"Problemas ABERTOS". No modo sem câmera isso já está resolvido (`.scan-sem-camera .scan-result`
fica em fluxo normal).

### NÃO fiz
- Fila offline de criação de walk-in (justificativa no item 4).
- `quickTipo` default `'comum'` (`ScannerModal.jsx:53` e `:144`) — continua errado para o ETHB
  (walk-in fica invisível nos filtros de Tipo). É decisão de produto qual default usar
  (`comprador` ou `convidado`); 1 linha, fora do meu escopo. **Alguém precisa decidir.**
- `ParticipantModal.jsx` `<select>` de tipo sem "Comprador" — mesmo motivo (item 3 dos abertos).
- `dist/` foi regenerado (`index-BySmK-sp.js` / `index-DbX4QlwF.css`, `index.html` já aponta para
  eles) e **não foi commitado**. Nada foi commitado.

## Frontend — onda 2 / design (03/08)

Escopo: só visual/layout/a11y. `db.js`, `server.js`, `exportRows.js`, `pessoa_token`, a máquina de
leitura (`BUSY_LOCK_MS`/`GAP_MS`/loop) e qualquer chamada de API **não foram tocados**.
JSX mexido só em classe/ícone/texto (`ScannerModal.jsx`, 5 pontos). Todo o resto é `styles.css`.

### 1. Card persistente E visor coexistindo no celular — RESOLVIDO

`.scan-result` deixou de ser `position:absolute; z-index:6; max-height:78vh` (overlay).
O scanner no celular virou **tela cheia com 3 zonas fixas em coluna** (`styles.css:606-680`):

```
head (compacto)          styles.css:800-810
zona 1  .scan-wrap       flex:1 1 auto; min-height:120px   -> visor sempre mirável
zona 2  .scan-result     flex:0 1 auto; max-height:58%     -> card, rola por dentro
zona 3  .scan-manual     flex:0 0 auto                     -> busca NUNCA encolhe
foot
```

- `.scanner-overlay` (classe nova, `ScannerModal.jsx:328`) zera o padding do overlay e o modal
  usa `100dvh` — o teclado do celular não empurra mais a busca para fora.
- Dentro do card, `.scan-perfil` é o único bloco que rola: **nome e status nunca saem da tela**.
- Modo sem câmera preservado e melhorado: coluna que rola inteira, com `order:-1` no
  `.scan-result` para o resultado da busca manual aparecer ACIMA do passo a passo da câmera
  (antes, com o novo flex, o card era espremido a 28px e ficava sob o bloco de instruções).

**Medições reais (Playwright + Chromium, API falsa), 360×740:**

| elemento | idle | com card aberto |
|---|---|---|
| visor `.scan-wrap` | 336×362 @y98 | 310×174 @y98-272 · `elementFromPoint` = `div.scan-frame` OK |
| card `.scan-result` | compacto | 255px @y282-537 |
| nome `.scan-nome` | — | y296-342, 20px/800 OK |
| status `.scan-status` | — | y385-439 OK |
| busca `.scan-manual-input` | y605-653 OK | **y617-665 · `elementFromPoint` = o próprio input OK** |

Com o card aberto E busca digitada, o item da lista (`.scan-manual-item`, y605-665) também
devolve a si mesmo no `elementFromPoint` — **o caminho de recuperação deixou de estar bloqueado**.
Idem em 390×844. Card **persiste** (testado 4s depois: 1 card na tela, sem auto-dismiss).
0 erros de JS no console nas 3 telas.

### 2. Estados legíveis sob luz forte

`.scan-status` era só texto colorido — e `dup` usava `var(--warning)` (#f59e0b) sobre fundo claro:
**2,2:1**. Virou bloco sólido, largura total, com ícone em círculo + texto (`styles.css:365-374`,
`ScannerModal.jsx:11-17` e `:270-273`):

| estado | ícone | fundo | tinta | contraste medido |
|---|---|---|---|---|
| ok | ✓ | `#0b6337` | `#fff` | **7,4:1** |
| duplicado | ! | `#ffc233` | `#2a1d00` | **10,2:1** (âmbar só como FUNDO, tinta escura) |
| erro | ✕ | `#a3121a` | `#fff` | **7,9:1** |

Verificado no navegador: `rgb(11,99,55)/rgb(255,255,255)` e `rgb(255,194,51)/rgb(42,29,0)`.
Verde e vermelho têm luminância parecida (0,109 vs 0,102) — em escala de cinza os dois blocos
ficam do mesmo tom, então o erro ganhou **borda de 4px** no card como 3º sinal, além do ícone.

### 3. Hierarquia

- `.scan-nome` 20px/800 no celular, 24px/800 no desktop. `.scan-status` 19-20px/800.
- Bloco de status é o elemento mais proeminente: a ação secundária "Marcar possível comprador"
  perdeu o laranja cheio e virou botão de contorno — gritava mais alto que o próprio resultado
  do credenciamento.
- Badges do card (nível/ingresso/tipo) subiram para 13px.
- Nada de leitura abaixo de 12px: `.grupo-dia` 10,5→12, `.destaque .d-k` 10,5→12,
  `.perfil-tbl th` 10,5→12, `.name-sub` 11,5→12,5, `.badge`/`.tbadge`/`.gbadge` 11→12,
  `.dash-legenda` e `.audit-quando` 11→12.

### 4. Alvos de toque

Piso de **44px no mouse** e **48px em aparelho de toque** (`@media (pointer:coarse),(max-width:760px)`).
Corrigidos: `.icon-btn` 34→44/48, `.search-clear` 28→40/48, `.op-chip .logout` 28→44/48,
`.filtro-chip button` e `.op-tag button` 20→32/40, `.check-btn` 30→44/48, `.ctl` 33→44/48,
`.filter button` 37→44/48, `.evt-seg` 36→44/48, `.tabs button` e `.view-tab` 35/40→48,
`.mais-menu button` 40→48, `.cfg-chip` 28→44/48, `.scan-manual-item` 44→56/60,
`.scan-recente button` 25→40/48, `.scan-continuar` virou botão de verdade (48/52, largura total),
`.scan-quick select` 42→48, `.btn.primary` 56px no celular, `.name-btn` 34→48 no toque,
`.field input/select/textarea` 41→44/48, checkbox `.rep-check`/`.ev-chk` 16→22px em label de 44px.
Gaps: `.filter` 2→6, `.eventbar-seg` 4→6, `.actions-cell` 6→8, `.qr-btns` 6→8,
`.scan-manual-list` 6→8, `.detail-foto-actions` 6→8, `.cfg-chips` 6→8, `.tabs`/`.view-nav` 4→8.
Varredura no navegador: no celular só sobram links de contato (`a` 75-91×44) — altura ok,
largura menor que 48 por serem links inline de texto (WCAG 2.5.8 pede 24×24).

### 5. Inconsistências de design system encontradas e unificadas

O mesmo estado usava cores diferentes e, pior, cores que **reprovavam em contraste como texto**:

| conceito | antes (valores soltos) | agora |
|---|---|---|
| verde de sucesso como TEXTO | `var(--success)` #1f9d57 (**3,5:1**), `#1f9d57` cravado em `.smi-cred` e `.tbadge-comprador`, `#0f6b3c` no selo HOJE, `#1f5c3a` em `.sce-ok` | `--success-text:#0f6b3c` (**6,6:1**) em 21 regras |
| âmbar como TEXTO | `var(--warning)` #f59e0b (**2,2:1**) em `.scan-status.dup`, `.dash-card.warn`, `.acao-descredenciar`, `.warn-num`, `.detail-status-pill.pend`; mais `#b3700a`, `#b45309`, `#8a5200`, `#7a4800` | `--warn-text:#8a5200` (**6,4:1**) + `--warn-bg`/`--warn-line` |
| vermelho como TEXTO | `var(--danger)` #e23b3b (**4,3:1**), `#c23535`, `#8f1a12`, `#7a2019` | `--danger-text:#a3121a` (**7,9:1**) + `--danger-bg`/`--danger-line` |
| laranja como TEXTO | `var(--primary)` #ef7c00 (**2,8:1**) e `var(--primary-deep)` #e56d02 (**3,2:1**) em abas, links, níveis, chips; mais `#c2590a`, `#b3600c`, `#a85500` | `--primary-ink:#a84c00` (**5,7:1**) |
| botão primário | gradiente #ef7c00→#e56d02 com texto branco: **2,8:1** | `--primary-btn:#bb5700`→`--primary-btn-2:#9c4700`: **4,7:1 e 6,3:1** |
| cinza terciário | `--muted-2:#8b929d` (**3,1:1**) | `#6b7280` (**4,8:1**) |
| cinza de badge | `#525866` em 6 lugares | `#4a505c` |
| `.btn.mini` | **definido 2× com valores conflitantes** (`6px 10px` e `5px 12px`) | uma regra só |
| fundos de aviso | `#fff4e0`/`#ffd58a`/`#e8b869` e `#fdecea`/`#e8a49d` repetidos cru | tokens |

Ícone por estado agora é o mesmo em todo lugar: ✓ verde / ! âmbar / ✕ vermelho.
**O laranja do botão primário ficou mais escuro** (queimado) — é a mudança visual mais
perceptível do pacote, e foi deliberada: com o laranja de marca o texto branco reprovava AA.
`--primary` #ef7c00 continua intacto para preenchimentos e a logo.

### 6. Responsividade — bugs reais corrigidos

- **360×740 tinha 120px de rolagem horizontal na lista** (390 tinha 90px). Causa: `.name-btn`
  com `white-space:nowrap` dentro de um `<td>` `flex:1 1 100%` sem `min-width:0` — o min-content
  da célula era maior que a tela. Medido: overflowX **120 → 0**.
- Resultados da busca podiam ficar atrás do rodapé no celular (`.scan-manual` encolhia): agora
  `flex:0 0 auto` com lista limitada a `min(34vh,232px)`.
- `.audit-row` (grid 96px/1fr/110px) virou 2 colunas abaixo de 560px.
- `.summary-metrics` vira 2 colunas abaixo de 640px (era 4 até 480px).
- Cabeçalho do scanner enxugado no celular (mais tela para visor e card).
- Chip de "Últimos" com nome longo agora trunca em vez de estourar a linha.

### 7. Acessibilidade fora do scanner

- **Foco visível global**: `outline:3px solid var(--primary-ink)` em `:focus-visible`.
  Havia `outline:none` sem substituto em `.ctl`, `.filtros-av select/input` e `.scan-quick select`.
  Verificado com Tab: 8 primeiros alvos, todos com anel `rgb(168,76,0)`.
- `prefers-reduced-motion: reduce` respeitado (animações e transições zeradas).
- `role="status"` no bloco de estado do card; ícone com `aria-hidden`.

### Verificação

`npm run build` OK (vite 5.4.21, 181 módulos). Navegador real (Chromium/Playwright) em
360×740, 390×844 e 1280×900, com API falsa: 0 erros de JS, overflowX 0 em lista/scanner/ficha/
formulário/dashboard, modais rolam, card persiste, visor e busca alcançáveis (provado com
`elementFromPoint`), teclado com foco visível, câmera negada com card no topo e busca funcionando.
No desktop o item da busca fica abaixo da dobra do `.modal-body` (que rola): confirmado clicável
após `scrollIntoView`.

### NÃO mexi (de propósito)

- `quickTipo` / `<select>` de tipo do `ParticipantModal` — segue sendo decisão de produto (onda 1).
- `.perfil-tbl` do dashboard ainda tem rolagem horizontal própria em 360px, mas está dentro de
  `.perfil-tab-wrap{overflow-x:auto}` e não vaza para a página. Reescrever a tabela em cards
  seria redesenho, não ajuste.
- Nenhuma lógica, máquina de estados do scanner, chamada de API, `db.js`, `server.js`,
  `exportRows.js` ou geração/resolução de `pessoa_token`.
- **Nada foi commitado.** `dist/` foi regenerado várias vezes (build atual: `index-BAhGY_l5.css`
  + o JS correspondente, com `index.html` já apontando para eles) e sobraram assets antigos
  não rastreados em `dist/assets/` de builds intermediários.
