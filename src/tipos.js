// Metadados dos tipos de cliente (rótulo + classe de cor da badge).
export const TIPOS = {
  comprador: { label: 'Comprador', cls: 'comprador' },
  convidado: { label: 'Convidado', cls: 'convidado' },
  comum:     { label: 'Comum',     cls: 'comum' },
  socio:     { label: 'Sócio',     cls: 'socio' },
  diamante:  { label: 'Diamante',  cls: 'diamante' },
};

export const ORDEM_FILTRO = ['todos', 'comprador', 'convidado', 'comum', 'socio', 'diamante'];

export function tipoLabel(t) {
  return (TIPOS[t] || TIPOS.comum).label;
}
export function tipoCls(t) {
  return (TIPOS[t] || TIPOS.comum).cls;
}
