# Context — decisões da fase Discuss (2026-05-29)

## GA-1 Escopo do import → **Tudo das abas "Credenciamento - *"**
Importar todas as linhas das abas oficiais de cada arquivo (Compradores + Diamantes, e Sócios na Imersão).
Dedupe por **documento** (fallback e-mail). Não importar _Vendas_ nem _ACESSOS 2026_.

## GA-2 Taxonomia de tipo → **Diamante > Sócio > Convidado > Comum**
Regra de classificação (primeira que casar, nessa ordem):
1. **diamante** — está na aba "Credenciamento - Diamantes" (ou instrução contém "DIAMANTE").
2. **socio** — instrução contém "SÓCIO", ou veio da aba "Sócios" (sócio convidado por um aluno).
3. **convidado** — possui "Nome da pessoa que indicou" (convidado/indicado) e não é sócio.
4. **comum** — caso contrário.
- `grupoDiamante` guarda o grupo do diamante (ex.: "Diamante Vermelho Titular").

## GA-3 Estrutura dos dias → **Clínica com lista diferente por dia**
- **Imersão**: 1 evento-dia, com a lista da Imersão.
- **Clínica**: 2 eventos-dia **independentes** (Dia 1 e Dia 2), cada um com sua própria lista e seu próprio credenciamento.
- Consequência no modelo: cada `participante` pertence a **um** evento-dia (`evento_id`) e tem seu próprio status de credenciamento (não há lista compartilhada nem tabela de junção).
- **Assunção de import (a confirmar):** os xlsx trazem **uma única** lista da Clínica. Vou carregá-la como o **Dia 1 da Clínica** e **replicar a mesma lista no Dia 2** como conjunto independente (mesmas pessoas, check-in separado por dia). Se cada dia tiver pessoas diferentes, basta enviar os 2 arquivos que re-importo por dia.

## Modelo final (simplificado — sem tabela de junção)
```
eventos(id, nome, tipo['imersao'|'clinica'|'passado'], ordem int, data date null,
        arquivado bool, ativo bool, criado_em)
participantes(id, evento_id FK -> eventos, nome, nomeCracha, email, telefone, documento,
        cidade, estado, turma, profissao, instrucao, nivel, faturamento, tamanhoCamisa,
        tipo['comum'|'socio'|'diamante'|'convidado'], grupoDiamante,
        convidadoPor, convidadoPorId, observacoes, dados_extra jsonb,
        recebeuCracha bool, credenciado bool, dataCredenciamento, operador, foto,
        criado_em, updated_at)
auditoria(... + evento_id)
```
- CHF 2026 Goiânia vira `eventos` arquivado; os 93 participantes recebem seu `evento_id` e `tipo` derivado da instrução.
