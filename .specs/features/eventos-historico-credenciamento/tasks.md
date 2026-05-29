# Tasks — Multi-eventos, histórico e credenciamento por dia

Legenda: [P] paralelizável · Done when = critério de verificação.

## Banco
- **T1** Migração `eventos` + colunas em `participantes` + índices. (FR-01)
  Done when: `list_tables` mostra `eventos` e as novas colunas; RLS ativo.
- **T2** Seed dos eventos: CHF2026 (arquivado), Imersão, Clínica D1, Clínica D2. (FR-01)
  Done when: `select * from eventos` retorna 4 linhas ordenadas.
- **T3** Migrar os 93 atuais → `evento_id`=CHF2026 e `tipo` derivado da instrução. (FR-07)
  Done when: todos os 93 têm evento_id e tipo preenchidos.

## Import
- **T4** Script `dados-uteis/importar.js`: lê xlsx, normaliza, classifica tipo, extrai convidadoPor, monta dados_extra, gera SQL em lotes. (FR-03/04/05)
  Done when: script roda local e gera arquivos .sql por evento.
- **T5** Popular Imersão (Compradores+Sócios+Diamantes) via MCP. (FR-03)
  Done when: count do evento Imersão > 0 e tipos distribuídos.
- **T6** Popular Clínica D1 e replicar em D2 via MCP. (FR-03)
  Done when: counts de D1 e D2 iguais (> 0), independentes.

## Backend
- **T7** `db.js`: repo escopado por evento (`listarEventos`, `listar(eventoId)`, `detalhe(id)`, credenciar/editar/etc com evento). (FR-06/09/11)
- **T8** `server.js`: rotas `/eventos`, `/participantes?evento=`, `/participantes/:id` detalhe; auditoria com evento. (FR-06/09)

## Front
- **T9** `api.js`: `listarEventos`, `listar(eventoId)`, `detalhe(id)`. [P]
- **T10** `EventBar.jsx` + estado `eventoId` no App; query por evento; stats por evento. (FR-06)
- **T11** Badges por tipo + filtro por tipo na toolbar; Diamante destacado. (FR-08/10) [P]
- **T12** `DetailModal.jsx` ao clicar no nome (GET /:id, todos os campos + quem convidou). (FR-09)
- **T13** `HistoryModal.jsx` — eventos arquivados read-only com números. (FR-07)
- **T14** `styles.css` — barra de eventos + cores de tipo. [P]

## Fecho
- **T15** `npm run build`, smoke local (boot, /eventos, /participantes?evento), commit + push.
  Done when: build ok; endpoints respondem; dist versionado; push na master.
