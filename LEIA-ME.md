# Credenciamento CHF 2026 — React + Express + MySQL (Hostinger)

App de credenciamento para o evento, reescrito numa stack moderna e robusta,
pronto para rodar como **Node.js App** no Hostinger Cloud Professional.

## Stack

- **Front-end:** React 18 + Vite + TanStack React Query (cache e sincronização)
- **Back-end:** Node.js + Express (API REST)
- **Banco:** MySQL da Hostinger (via `mysql2`)
- O Express serve a API em `/api` **e** o front já compilado (pasta `dist/`).

## Por que é mais robusto que a versão anterior

- **Sem sobrescrita entre estações:** cada ação (credenciar, editar, excluir) é
  uma operação individual no banco. Dois atendentes ao mesmo tempo não apagam o
  trabalho um do outro (antes salvava a lista inteira a cada clique).
- **Login por operador:** cada pessoa entra com o próprio nome + senha do evento.
- **Auditoria:** toda ação fica registrada (quem, o quê, quando) na tabela `auditoria`.
- **Fotos sob demanda:** a listagem é leve; a foto só é carregada ao abrir o cadastro/visualização.
- **Credenciamento instantâneo:** atualização otimista na tela + sincronização a cada 5s.

## Estrutura

```
server.js          # Express: API REST + serve o front (dist/)
db.js              # Conexão MySQL, criação das tabelas e seed inicial
data.json          # Dados iniciais (importados 1x, quando o banco está vazio)
index.html         # Entrada do Vite
src/               # Código React (App, componentes, api.js, estilos)
.env.example       # Modelo das variáveis de ambiente
dist/              # Build do front (gerado por "npm run build")
```

---

## Deploy no Hostinger (Node.js App)

### 1. Suba o código para o GitHub
Crie um repositório e faça push deste projeto (o `.gitignore` já evita subir
`node_modules` e `dist`).

### 2. Crie o banco MySQL no hPanel
**Bancos de dados → Bancos de dados MySQL** → crie banco + usuário e **anote**
nome do banco, usuário, senha e host (geralmente `localhost`).

### 3. Crie a Node.js App
No hPanel: **Sites → Adicionar site → Node.js Apps**.
- **Importe o repositório Git** (ou suba um ZIP).
- **Versão do Node:** 20 ou 22.
- **Comando de build:** `npm run build`
- **Arquivo de entrada / start:** `server.js` (start = `npm start`).

### 4. Configure as variáveis de ambiente
No painel da app, em **Environment Variables**, defina:

| Variável          | Valor                                            |
|-------------------|--------------------------------------------------|
| `DB_HOST`         | `localhost` (ou o host informado pela Hostinger) |
| `DB_PORT`         | `3306`                                           |
| `DB_NAME`         | nome do banco                                    |
| `DB_USER`         | usuário do banco                                 |
| `DB_PASS`         | senha do banco                                   |
| `ACCESS_PASSWORD` | senha que os operadores usam para entrar         |
| `SESSION_SECRET`  | uma string longa e aleatória                     |

> Dica: o **Assistente de Conexão de Banco** da Hostinger preenche as variáveis
> `DB_*` automaticamente. **Não** defina `PORT` — a Hostinger injeta sozinha.

### 5. Faça o deploy
A Hostinger instala as dependências, roda o build e inicia o `server.js`.
Na primeira execução, as tabelas são criadas e o `data.json` é importado.
Acesse o domínio → tela de login → entre com seu nome + a `ACCESS_PASSWORD`.

A cada novo `git push`, a Hostinger redeploya automaticamente.

---

## Rodar localmente (desenvolvimento)

```bash
cp .env.example .env      # preencha com um MySQL local
npm install
npm run dev               # sobe API (3000) + Vite (5173, com proxy /api)
```
Acesse http://localhost:5173.

Para testar igual produção (front compilado servido pelo Express):
```bash
npm run build
npm start                 # tudo em http://localhost:3000
```

## Backup
- Botão **Exportar** gera um `.json` com tudo (inclui fotos). Faça ao fim do evento.
- O Cloud Professional também faz **backup diário automático** do banco.
