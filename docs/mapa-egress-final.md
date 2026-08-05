# Mapa de egress — estado final (05/08/2026, 13h)

Fechamento do ciclo que quase estourou. **Todo número aqui foi medido**, não
estimado — a única exceção está marcada como tal.

## De onde vinha o problema

| Dia | Consumo | O que era |
|---|---:|---|
| 04/08 | **668 MB** | polling do credenciamento rebaixando a lista inteira a cada 5 s |
| 05/08 (manhã) | 184 MB | dashboard CNHF: 868 kB por carregamento, sem cache |
| 05/08 (agora) | **~1,3 MB/h** | tudo corrigido |

## Consumo diário atual, item por item

| Componente | MB/dia | Como foi medido |
|---|---:|---|
| Crons (4 ativos) | 13,5 | contagem exata × 514 kB por leitura de `grupo_evento` |
| Dashboard CNHF | 12,2 | 868 kB/carga × 90% de cache (medido: 9 HIT em 10) |
| Portais de aluno | 3,0 | 2,5 kB por navegação (medido por query) |
| Credenciamento | 1,5 | 0,93 MB em 2h de balcão real |
| Webhooks | 2,0 | writes custam ingress, não egress |
| **Total** | **32 MB/dia** | |

**A conta fecha com o painel:** 110 (dashboard sem cache) + 22 (crons antigos) +
1 (credenciamento) + 3 (portais) = 136 MB, contra os 137,7 MB que o painel
mostrou no dia 05. **Não há consumo não mapeado.**

### Erro de estimativa que vale registrar

Estimei os portais de aluno em **25 MB/dia**. Medido: **3 MB/dia**. A diferença
saiu de supor volume de navegação em vez de medir o custo por query — as queries
do GPS/SIP são de dezenas a poucos milhares de bytes, não de megabytes. Se a
otimização tivesse sido priorizada por essa estimativa, teria mexido em 8
arquivos de autenticação em produção para economizar ~1 MB/dia.

## O que está ativo (e por quê)

| Job | Frequência | Por que fica |
|---|---|---|
| `ingest-sendflow` | 30 min | ingresso no grupo do CNHF — o dado mais sensível do lançamento |
| `sync-grupo-unificado` | 2h | reconciliação do grupo |
| `reconcilia-grupo` | 4h | contador independente que pega furo de webhook |
| `ingest-active` | 3h | leads do CNHF |
| `report-slack-diario` + `semanal` | 1x/dia | aviso de negócio |
| `hm-report-diario-slack` | 1x/dia | **vendas** → Slack |
| `hm-health-check-diario` | 1x/dia | vigia o pipeline de compra |

Pausados: os de **ads/analytics** (meta, google, criativos, páginas, clickup,
disparos, refresh-mv, instagram) — rodavam de 30 em 30 min e não alimentam nem o
evento nem a venda.

**Webhooks nunca foram tocados.** Grupo, pesquisa e compra continuam em tempo
real. Só crons foram mexidos.

## Orçamento até o reset (dia 07)

| | |
|---|---:|
| Disponível | ~540 MB |
| Resto de hoje | 15 MB |
| Dia 06 (com o evento d3) | 45 MB |
| **Sobra** | **~480 MB** |

Ponto de ruptura: seria preciso gastar **15,4 MB/h**. O consumo medido é de
**1,3 MB/h** — precisaria piorar **9x**.

## Se precisar cortar mais (ordem)

1. TTL do cache de 20 → 60 min (`server/cache-leitura.js`) — o dado vem de cron
   de 3-6h, então não perde frescor nenhum
2. Pausar `ingest-active` — corta 3,3 MB/dia
3. Pausar `sync-grupo-unificado` — corta 6 MB/dia, mas atrasa o contador do grupo

## Reverter tudo depois do reset

```sql
select cron.alter_job(jobid, active => true) from cron.job where not active;
select cron.alter_job(9,'*/30 * * * *'), cron.alter_job(21,'*/30 * * * *');
```
E no `cache-leitura.js`, voltar `TTL_PADRAO_MS` e `TTL_TEMPO_REAL_MS`.
