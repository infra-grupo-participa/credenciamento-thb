# Spec — Multi-eventos, histórico e credenciamento por dia

**Status:** spec → aguardando decisões (discuss)
**Owner:** marcio@advmais.com
**Data:** 2026-05-29
**Tamanho:** **Complex** (novo domínio de dados, multi-evento, import de planilhas, novo modelo no Supabase, mudanças amplas no front)

## Origem

O app hoje tem uma única lista (`participantes`, 93 registros do evento passado **CHF 2026 Goiânia**, 79 credenciados). Vamos transformá-lo num sistema multi-evento com histórico, importando as listas reais de dois novos eventos a partir dos xlsx em `dados-uteis/`.

## Objetivo

1. **Histórico**: aba que guarda eventos passados (o CHF 2026 Goiânia atual vira o primeiro item do histórico, somente leitura).
2. **Novos eventos** (3 dias de credenciamento, cada DIA é um evento único de check-in):
   - **Imersão** — 1 dia.
   - **Clínica** — 2 dias (logo após a Imersão). Mesma lista de participantes nos 2 dias, mas credenciamento independente por dia.
3. **Importar** as listas dos xlsx para o Supabase, **sem misturar** Clínica e Imersão.
4. **Tipos de cliente** diferenciados visualmente: **Comum**, **Sócio** (convidado por ser sócio de um aluno), **Diamante** (VIP), **Convidado** (geral, precisa estar na mesma lista mas distinguível).
5. **Modal de detalhes**: ao clicar no nome, mostrar TODAS as informações daquela pessoa (facilita o credenciamento).
6. **Quem convidou**: para convidados/sócios, guardar pelo menos o nome de quem convidou; associar ao titular no sistema (criar referência mesmo que o titular não exista como registro próprio).

## Estrutura dos xlsx (fonte)

### Clínica
- **Credenciamento - Compradores** — lista oficial de compradores. Campos úteis: Nome, Documento, Email, DDD, Telefone, Cidade/Estado, Instrução (`THB`/`AURUM`/`PLATINA`/`... - SÓCIO`), Turma, Profissão, Nível, Faturamento, Camisa, Nome do crachá.
- **Credenciamento - Diamantes** — Nome completo, E-mail, Telefone, "Qual é o seu grupo" (`Diamante Titular`, `Diamante Vermelho Titular`, `Diamante Vermelho Sócio`), Camisa, Turma.
- _Vendas_ e _ACESSOS 2026_: fontes/roster — não são a lista de credenciamento.

### Imersão
- **Credenciamento - Compradores** — igual + **Nome/Email/Telefone da pessoa que indicou** (quem convidou), `Convidou Sócio?`, `Já participou de HT?`, `Nível em Holding`, `Faturamento mensal`.
- **Sócios** — relação aluno → sócio: Nome (aluno que convidou), e Nome/Email/Documento/Telefone **do sócio** convidado, `Sócio entrou no grupo?`.
- **Credenciamento - Diamantes** — Nome, E-mail, Telefone, grupo, `Está no grupo da Imersão?`.

## Modelo de dados proposto (Supabase / Postgres)

```
eventos
  id (uuid/text) PK, nome, tipo ('imersao'|'clinica'|'passado'),
  dia (int, ordem do dia no evento), data (date null), ativo (bool),
  arquivado (bool, true = histórico), criado_em

participantes
  id PK, evento_grupo ('imersao'|'clinica'|'chf2026'),  -- a qual LISTA pertence
  nome, nomeCracha, email, telefone, documento, cidade, estado,
  turma, profissao, instrucao, nivel, faturamento, tamanhoCamisa,
  tipo ('comum'|'socio'|'diamante'|'convidado'),
  grupoDiamante (text null, ex 'Diamante Vermelho Titular'),
  convidadoPor (text null),            -- nome de quem convidou
  convidadoPorId (text null),          -- ref ao titular, se existir
  observacoes, dados_extra (jsonb),    -- todo o resto do xlsx p/ o modal
  criado_em, updated_at

credenciamentos                        -- check-in POR DIA (evento)
  id PK, participante_id FK, evento_id FK,
  credenciado (bool), dataCredenciamento, operador,
  UNIQUE(participante_id, evento_id)
```

- Os 93 atuais migram para `evento_grupo='chf2026'`, com um `eventos` arquivado e seus credenciamentos preservados.
- Clínica gera 2 eventos-dia que **compartilham** a mesma lista (`evento_grupo='clinica'`); Imersão gera 1 evento-dia (`evento_grupo='imersao'`).

## Requisitos (rastreáveis)

- **FR-01** Tabela `eventos` com Imersão (1 dia) + Clínica (2 dias) + CHF2026 (arquivado).
- **FR-02** Tabela `credenciamentos` por (participante, evento-dia); credenciar/descredenciar é por dia.
- **FR-03** Importador lê os xlsx e popula `participantes` por lista, sem misturar; dedupe por documento/email.
- **FR-04** Classificação de tipo: comum / socio / diamante / convidado (regra em §discuss).
- **FR-05** `convidadoPor` preenchido para sócios (aba Sócios) e convidados (coluna "pessoa que indicou").
- **FR-06** Front: seletor de evento + dia no topo; cada dia mostra seu próprio progresso de credenciamento.
- **FR-07** Aba/visão **Histórico** lista eventos arquivados (somente leitura) com seus números.
- **FR-08** Badge/cor distinta por tipo na lista (Diamante destacado).
- **FR-09** Modal de detalhes ao clicar no nome, exibindo todos os campos conhecidos (inclui quem convidou e dados_extra).
- **FR-10** Filtro por tipo (além de pendentes/credenciados) e busca continua funcionando.
- **FR-11** RLS mantido; acesso só via service_role (servidor). Auditoria registra credenciamentos por dia/operador.

## Fora de escopo (por ora)

- Importar abas _Vendas_ e _ACESSOS 2026_ (fontes; não são listas de credenciamento).
- Cadastro de novos eventos pela UI (eventos criados via migração/seed).
- Relatórios/exportação avançada por dia (mantém Exportar atual).

## Gray areas (decisões do usuário — discuss)

- **GA-1 Escopo do import**: as abas "Credenciamento - Compradores" têm ~1500 linhas (parecem o export completo de compradores, com "Possível comprador? NÃO" em vários). Importar todas, ou filtrar (ex.: "Entrou no grupo? = Sim" / transação aprovada)?
- **GA-2 Taxonomia de tipo** quando há sobreposição (ex.: um Diamante que também é Sócio): qual prioridade de rótulo?
- **GA-3 Estrutura dos dias**: confirmar Imersão=1 dia, Clínica=2 dias com a MESMA lista e check-in independente por dia.

## Acceptance criteria de alto nível

- [ ] Topo do app permite escolher **evento e dia**; o progresso/contadores refletem o dia escolhido.
- [ ] Credenciar alguém no **Dia 2 da Clínica** não marca como credenciado no **Dia 3** (independência por dia).
- [ ] **Histórico** mostra o CHF 2026 Goiânia com 93/79 (somente leitura).
- [ ] Lista de cada evento traz os tipos com cores distintas; Diamantes destacados.
- [ ] Clicar no nome abre modal com todos os dados da pessoa, incluindo **quem convidou**.
- [ ] Listas de Clínica e Imersão nunca se misturam.
