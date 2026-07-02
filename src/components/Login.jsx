import { useEffect, useState } from 'react';
import { api, auth } from '../api.js';

const MENSAGENS = {
  senha_invalida: 'Senha incorreta.',
  informe_o_nome: 'Informe seu nome.',
};

export default function Login({ onLogin }) {
  const [operador, setOperador] = useState(auth.operador);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [ops, setOps] = useState([]);

  useEffect(() => { api.operadoresPublicos().then((r) => setOps(r.operadores || [])).catch(() => {}); }, []);

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
        <img className="brand-logo-lg" src="/thb-logo.png" alt="Time Holding Brasil" />
        <h2>Credenciamento THB</h2>
        <p className="sub">Entre para começar o atendimento</p>
        <div className="field">
          <label>Seu nome (operador)</label>
          <input value={operador} onChange={(e) => setOperador(e.target.value)}
            list="lista-operadores" autoComplete="off" placeholder="Ex: Marcio" autoFocus required />
          <datalist id="lista-operadores">{ops.map((n) => <option key={n} value={n} />)}</datalist>
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
