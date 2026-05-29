// Metadados dos tipos de cliente (rótulo + classe de cor da badge).
export const TIPOS = {
  comum:     { label: 'Comum',     cls: 'comum' },
  socio:     { label: 'Sócio',     cls: 'socio' },
  diamante:  { label: 'Diamante',  cls: 'diamante' },
  convidado: { label: 'Convidado', cls: 'convidado' },
};

export const ORDEM_FILTRO = ['todos', 'comum', 'socio', 'diamante', 'convidado'];

export function tipoLabel(t) {
  return (TIPOS[t] || TIPOS.comum).label;
}
export function tipoCls(t) {
  return (TIPOS[t] || TIPOS.comum).cls;
}
