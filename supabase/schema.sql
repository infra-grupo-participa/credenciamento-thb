-- Schema do credenciamento CHF 2026 (Supabase / PostgreSQL)
-- Rode isto uma vez no Supabase: Dashboard -> SQL Editor -> New query -> Run.
-- (As colunas usam camelCase entre aspas para casar com o app sem mapeamento.)

create table if not exists public.participantes (
  "id"                 text primary key,
  "nome"               text not null,
  "nomeCracha"         text,
  "email"              text,
  "telefone"           text,
  "turma"              text,
  "profissao"          text,
  "tamanhoCamisa"      text,
  "dataChegada"        text,
  "dataRetorno"        text,
  "instrucao"          text,
  "recebeuCracha"      boolean not null default false,
  "credenciado"        boolean not null default false,
  "dataCredenciamento" text,
  "observacoes"        text,
  "foto"               text,
  -- coluna calculada: true quando há foto (evita trafegar a foto na listagem)
  "temFoto"            boolean generated always as ("foto" is not null and "foto" <> '') stored,
  "criado_em"          timestamptz not null default now(),
  "updated_at"         timestamptz not null default now()
);

create index if not exists idx_participantes_nome        on public.participantes ("nome");
create index if not exists idx_participantes_credenciado on public.participantes ("credenciado");
-- Índices de produção (já aplicados no projeto): resolução de QR e delta-polling.
create index if not exists idx_part_evento         on public.participantes ("evento_id");
create index if not exists idx_part_evento_cred    on public.participantes ("evento_id", "credenciado");
create index if not exists idx_part_evento_token   on public.participantes ("evento_id", "pessoa_token");
create index if not exists idx_part_evento_updated on public.participantes ("evento_id", "updated_at" desc);

create table if not exists public.auditoria (
  "id"           bigint generated always as identity primary key,
  "participante" text,
  "nome"         text,
  "acao"         text not null,
  "operador"     text,
  "detalhe"      text,
  "criado_em"    timestamptz not null default now()
);

-- Observação sobre segurança:
-- O app acessa o banco apenas pelo servidor (Express) usando a chave service_role,
-- que ignora RLS. Tabelas criadas via SQL já vêm com RLS desabilitado, então
-- não é necessário criar policies. Não exponha a service_role key no front-end.
