# Arquitetura — Credenciamento THB

Sistema de credenciamento multi-evento (Imersão, Clínica, Encontro de Diamantes…),
com leitura de QR, busca manual, modo offline e operação por vários atendentes
ao mesmo tempo. Pensado para ser **100% operável pela equipe, sem dev**.

## 1. Stack

- **Front-end:** React 18 + Vite + TanStack React Query (cache, sync a cada 5s,
  persistência offline). PWA via `vite-plugin-pwa` (service worker `autoUpdate`).
- **Back-end:** Node.js + Express (API REST em `/api`) — serve também o front já
  compilado (`dist/`).
- **Banco:** Supabase (PostgreSQL) via `@supabase/supabase-js`. RLS ligado; o
  servidor usa a chave `service_role` (variável de ambiente).
- **Libs-chave:** `qrcode` (gera QR no servidor), `jsqr` (lê QR no navegador),
  `xlsx` (import/export, carregada sob demanda).
- **Deploy:** Hostinger Cloud Professional (Node.js App). `dist/` é **versionado**
  no git (a Hostinger não leva o build para o runtime). Deploy = `git push`.

## 2. Topologia

```
Navegador (React PWA)
  │  fetch /api/*  (TanStack Query: poll 5s + cache offline em localStorage)
  ▼
Express (server.js)
  ├─ /api/*  rotas REST (auth por token de sessão)
  ├─ /qr/:token      página pública com o QR + nome do evento
  ├─ /qrimg/:token   PNG do QR (usado em =IMAGE() no Excel)
  └─ serve dist/ (SPA)
  │  @supabase/supabase-js (service_role)
  ▼
Supabase / PostgreSQL  (projeto "credenciamento-thb")
```

Há um **segundo projeto Supabase**, "Grupo Participa Database" (`thb_alunos`,
`compradores`…), usado **apenas como fonte de enriquecimento** (documento,
telefone, endereço, nível, redes) — cruzado por documento/e-mail. Não faz parte
do runtime do credenciamento.

## 3. Modelo de dados (projeto credenciamento)

- **`eventos`** — `id` (texto), `nome`, `tipo` (imersao|clinica|passado), `ordem`
  (ordenação na barra), `data`, `ativo`, `arquivado`. Cada dia é um evento
  separado (ex.: `clinica-d1`, `clinica-d2`).
- **`participantes`** — pertence a **um** `evento_id`. Campos: identidade (nome,
  nomeCracha, email, telefone, documento, cidade, estado), evento (turma,
  tamanhoCamisa, tipo, grupoDiamante, grupo, convidadoPor, instrucao, nivel),
  status (`credenciado`, `dataCredenciamento`, `recebeuCracha`), `pessoa_token`
  (base do QR), `foto` (base64, carregada à parte), `temFoto` (coluna gerada),
  `dados_extra` (jsonb com colunas extras da planilha + enriquecimento THB).
  **Check-in é independente por evento/dia** (cada linha tem seu `credenciado`).
- **`app_config`** — config global por chave: `auth` (hash da senha do evento),
  `operadores` (lista p/ login), `detalhe` (campos fixados no modal).
- **`auditoria`** — toda ação (credenciar, editar, excluir…): quem, o quê, quando.
- **View `vw_eventos`** — contadores (total/credenciados) por evento.

## 4. QR e token (regra central)

- `pessoa_token = sha1("<grupo>|<chave>")[:24]`, chave = documento(dígitos) >
  e-mail > nome.
- **Grupo do QR** = `grupoDe(evento_id)`: ids no padrão `base-dN` colapsam para
  `base` (ex.: `clinica-d1`→`clinica`, `diamantes-d2`→`diamantes`). Logo, **o
  mesmo QR da pessoa vale em todos os dias do mesmo evento**, mas um QR de um
  evento **não** credencia em outro.
- `/api/resolver?evento&token` → 200 (achou, credencia) · 409 (pessoa é de outro
  evento, informa qual) · 404 (não cadastrado). O 409/404 dispara a **busca
  manual** (nome/CPF) dentro do scanner.

## 5. Autenticação

- Login = nome do operador + **senha do evento** (compartilhada). Valida contra
  `app_config.auth.senhaHash` (sha256) com fallback para a env `ACCESS_PASSWORD`.
- Sessão = token assinado (`SESSION_SECRET`) enviado nas chamadas `/api`.

## 6. Offline / multi-estação

- TanStack Query faz **poll a cada 5s** e mantém cache; se cair a conexão, a tela
  segue funcionando.
- Credenciamentos feitos offline entram numa **fila em localStorage**
  (`src/offline.js`) e **sincronizam sozinhos ao reconectar** (operação
  idempotente). Indicador de online/pendentes no topo.
- Cada ação é uma operação individual no banco → **sem sobrescrita** entre
  atendentes simultâneos.

## 7. Importação / Exportação

- **Importar** (no app): CSV/Excel com detecção automática de colunas
  (`SettingsModal` → mapearColunas/montarLinhas), modos substituir/adicionar.
- **Importador dev** (`dados-uteis/importar.js`): para exports THB multi-aba.
- **Exportar** (Excel/CSV): util único `src/exportRows.js` — 24 colunas fixas,
  sem duplicidade, com QR como imagem (`=IMAGE(/qrimg/token)`). Usado pelo botão
  principal e pelo Dashboard.

## 8. Autonomia da equipe (sem dev)

Pela tela: criar/editar/arquivar eventos (inclusive **multi-dia com QR único**),
adicionar/editar/excluir pessoas (**todos os campos**, incl. foto), importar
listas, gerenciar operadores e a senha, credenciar (QR/busca/manual/desfazer),
ver painel e exportar.

## 9. Mapa de arquivos

```
server.js                 API REST + /qr + /qrimg + serve dist/
db.js                     camada Supabase: grupoDe/tokenDe, repo (CRUD), auditoria
src/App.jsx               tela principal: lista, busca, filtros, scan, export
src/api.js                cliente REST
src/exportRows.js         formato único de exportação (Excel/CSV)
src/offline.js            fila offline + flush
src/components/
  ScannerModal.jsx        leitura de QR + busca manual rápida (kiosque)
  ParticipantModal.jsx    cadastro/edição de pessoa (todos os campos)
  DetailModal.jsx         detalhe, credenciar, foto, QR, msg WhatsApp, crachá
  DashboardModal.jsx      painel + auditoria + exports
  SettingsModal.jsx       eventos / importar / operadores / senha
  EventBar.jsx            troca de evento (ordenado por dia)
dist/                     build versionado (servido em produção)
```
