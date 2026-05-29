import { useState } from 'react';
import { api, auth } from '../api.js';
import { IconBadge } from '../icons.jsx';

const MENSAGENS = {
  senha_invalida: 'Senha incorreta.',
  informe_o_nome: 'Informe seu nome.',
};

export default function Login({ onLogin }) {
  const [operador, setOperador] = useState(auth.operador);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      const data = await api.login(operador.trim(), senha);
      auth.set(data);
      onLogin(data.operador);
    } catch (err) {
      setErro(MENSAGENS[err.code] || 'Não foi possível entrar. Verifique a conexão.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login-overlay">
      <form className="login-card" onSubmit={submit}>
        <div className="logo"><IconBadge /></div>
        <h2>Credenciamento CHF 2026</h2>
        <p className="sub">Entre para começar o atendimento</p>
        <div className="field">
          <label>Seu nome (operador)</label>
          <input value={operador} onChange={(e) => setOperador(e.target.value)}
            autoComplete="name" placeholder="Ex: Marcio" autoFocus required />
        </div>
        <div className="field">
          <label>Senha do evento</label>
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)}
            autoComplete="current-password" required />
        </div>
        <button type="submit" className="btn primary" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
        <div className="login-error">{erro}</div>
      </form>
    </div>
  );
}
