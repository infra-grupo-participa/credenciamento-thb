# Design — Multi-eventos, histórico e credenciamento por dia

## Arquitetura geral
Mantém a stack atual: React + React Query (front, `dist` versionado) · Express + supabase-js (API) · Supabase/Postgres. Mudança é aditiva: novas tabelas/colunas + endpoints com escopo de evento + UI de seleção de evento.

## Banco (migração via MCP `apply_migration`)
1. `eventos` (ver context.md). Seed: CHF2026 (arquivado, ordem 0), Imersão (ordem 1), Clínica Dia 1 (ordem 2), Clínica Dia 2 (ordem 3).
2. `participantes`: adicionar colunas `evento_id`, `tipo`, `grupoDiamante`, `documento`, `cidade`, `estado`, `nivel`, `faturamento`, `convidadoPor`, `convidadoPorId`, `dados_extra jsonb`. Manter as existentes.
3. Migrar os 93: `evento_id` = CHF2026; `tipo` derivado de `instrucao` (regra GA-2; sem diamantes/sócios → maioria 'comum', '... SÓCIO' → 'socio').
4. RLS já habilitado; índices em (`evento_id`), (`evento_id`,`credenciado`), (`nome`).

## Import (Node + xlsx → SQL, executado via MCP `execute_sql` em lotes)
Script `dados-uteis/importar.js` (uso único, fora do runtime do app):
- Lê cada arquivo, normaliza por aba, classifica `tipo`, extrai `convidadoPor` (aba Sócios: aluno→sócio; Compradores Imersão: "pessoa que indicou").
- Junta Compradores + Diamantes (+ Sócios) por arquivo, dedupe por documento/email.
- `dados_extra` = objeto com todas as colunas originais (para o modal).
- Gera `INSERT`s idempotentes (`on conflict do nothing`) por evento_id, em lotes ~300 linhas.
- Imersão → evento Imersão. Clínica → evento Clínica Dia 1 e replicado no Dia 2.

## API (server.js + db.js repo)
- `GET /api/eventos` → lista eventos (ordenados; inclui flags arquivado/ativo e contadores total/credenciados por evento).
- `GET /api/participantes?evento=ID` → lista leve **filtrada por evento** (inclui `tipo`, `grupoDiamante`, `convidadoPor`, `temFoto`).
- `GET /api/participantes/:id` → **detalhe completo** (todas colunas + `dados_extra`) para o modal.
- `PATCH /:id/credenciar`, `PUT /:id`, `POST/DELETE`, foto, export, import → escopados por evento; create exige `evento_id`.
- Histórico = `GET /api/eventos` already inclui arquivados; front separa.
- Auditoria grava `evento_id`.

## Front (React)
- **EventoContext / seletor**: barra no topo (abaixo do header) com os eventos ativos (Imersão · Clínica D1 · Clínica D2) como abas; troca o `evento` da query `['participantes', eventoId]`.
- **Histórico**: botão "Histórico" abre uma visão (modal/rota) listando eventos arquivados com seus números (somente leitura → clicar mostra a lista read-only).
- **Tipos**: badge colorida por `tipo` (Diamante = destaque dourado/vermelho; Sócio = roxo/azul; Convidado = âmbar; Comum = neutro) + filtro por tipo na toolbar.
- **DetailModal**: clicar no nome busca `GET /:id` e exibe todos os campos agrupados (Pessoa, Evento/Turma/Instrução/Nível, Contato, Quem convidou, Observações, Extras do dados_extra). Mantém o PhotoModal como aba/foto.
- **Stats**: contadores refletem o evento selecionado.

## Componentes novos/alterados
- `EventBar.jsx` (novo) — seletor de evento/dia + acesso ao Histórico.
- `HistoryModal.jsx` (novo) — lista de eventos arquivados.
- `DetailModal.jsx` (novo) — detalhes completos do participante.
- `App.jsx` — estado `eventoId`, query por evento, filtro por tipo, badges.
- `api.js` — `listarEventos`, `listar(eventoId)`, `detalhe(id)`.
- `db.js`/`server.js` — endpoints acima.
- `styles.css` — badges por tipo + barra de eventos.
