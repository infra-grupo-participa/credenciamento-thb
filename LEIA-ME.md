# Credenciamento THB — React + Express + Supabase (Hostinger)

App de credenciamento **multi-evento** (Imersão, Clínica, Encontro de Diamantes…),
com leitura de QR, busca manual, modo offline e operação por vários atendentes ao
mesmo tempo. Roda como **Node.js App** no Hostinger Cloud Professional.

> Visão técnica completa (modelo de dados, regra do QR, fluxo de auth, mapa de
> arquivos): veja **[ARQUITETURA.md](ARQUITETURA.md)**.

## Stack

- **Front-end:** React 18 + Vite + TanStack React Query (cache, sync e offline).
  PWA (`vite-plugin-pwa`).
- **Back-end:** Node.js + Express (API REST em `/api`), que também serve o front
  compilado (`dist/`).
- **Banco:** **Supabase (PostgreSQL)** via `@supabase/supabase-js`. RLS ligado; o
  servidor usa a chave **service_role**.
- O `dist/` é **versionado no git** (a Hostinger não leva o build para o runtime).

## Por que é robusto

- **Sem sobrescrita entre estações:** cada ação (credenciar, editar, excluir) é uma
  operação individual no banco — dois atendentes ao mesmo tempo não se atrapalham.
- **Offline:** se a conexão cair, o credenciamento continua e entra numa fila local
  que **sincroniza sozinha ao reconectar**.
- **Login por operador** + **senha do evento**; **auditoria** de todas as ações.
- **Fotos sob demanda:** a listagem é leve; a foto carrega só ao abrir o cadastro.

## Estrutura

```
server.js          # Express: API /api + /qr/:token + /qrimg/:token + serve dist/
db.js              # Camada Supabase: grupoDe/tokenDe, repo (CRUD), auditoria
src/               # React (App, componentes, api.js, exportRows.js, offline.js)
dist/              # Build do front (versionado; servido em produção)
dados-uteis/       # Importador dev (xlsx) — uso pontual, fora do runtime
ARQUITETURA.md     # Visão geral da arquitetura
```

---

## Deploy no Hostinger (Node.js App)

### 1. Suba o código para o GitHub
`node_modules` é ignorado; **`dist/` é versionado** (necessário no runtime).

### 2. Crie o projeto no Supabase
Em [supabase.com](https://supabase.com), crie o projeto e pegue em
**Project Settings → API**: a **Project URL** e a chave **`service_role`**.

### 3. Crie a Node.js App
No hPanel: **Sites → Adicionar site → Node.js Apps**.
- Importe o repositório Git.
- **Node:** 20 ou 22 · **Build:** `npm run build` · **Start:** `npm start` (`server.js`).

### 4. Variáveis de ambiente
No painel da app, em **Environment Variables**:

| Variável                    | Valor                                              |
|-----------------------------|----------------------------------------------------|
| `SUPABASE_URL`              | a **Project URL** do Supabase                      |
| `SUPABASE_SERVICE_ROLE_KEY` | a chave **service_role** (secreta, só no servidor) |
| `ACCESS_PASSWORD`           | senha que os operadores usam para entrar           |
| `SESSION_SECRET`            | uma string longa e aleatória                       |

> **Não** defina `PORT` — a Hostinger injeta sozinha. A senha do evento também pode
> ser trocada depois pela tela (⚙ **Configurações → Senha**), que tem prioridade.

### 5. Deploy
A Hostinger instala dependências, roda o build e inicia o `server.js`. Acesse o
domínio → login (nome do operador + senha). A cada `git push`, redeploy automático.

---

## Rodar localmente

```bash
cp .env.example .env      # preencha SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev               # API (3000) + Vite (5173, proxy /api)
```
Acesse http://localhost:5173. Para testar como em produção:
```bash
npm run build && npm start   # tudo em http://localhost:3000
```

## Operação pela equipe (sem dev)

Pela tela: criar/editar/arquivar **eventos** (inclusive **vários dias com o mesmo
QR**), adicionar/editar/excluir **pessoas** (todos os campos + foto), **importar**
listas (CSV/Excel), gerenciar **operadores** e **senha**, **credenciar** (QR, busca
por nome/CPF, manual, desfazer), ver **painel** e **exportar** (Excel com o QR como
imagem). Detalhes em [ARQUITETURA.md](ARQUITETURA.md).

## Backup
- **Exportar** (Excel/CSV) ao fim de cada evento.
- O Supabase mantém backups do banco no plano do projeto.
