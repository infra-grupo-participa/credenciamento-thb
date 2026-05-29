import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { IconCheckCircle, IconAlert } from '../icons.jsx';

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);

  const toast = useCallback((msg, kind = '') => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'danger' ? <IconAlert /> : <IconCheckCircle />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
