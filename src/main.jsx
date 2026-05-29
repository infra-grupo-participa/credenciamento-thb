import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import App from './App.jsx';
import { ToastProvider } from './components/Toasts.jsx';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 2000,
      gcTime: 1000 * 60 * 60 * 24, // 24h — mantém no cache p/ persistência offline
    },
  },
});

// Persiste o cache no localStorage: a última lista carregada aparece offline.
const persister = createSyncStoragePersister({ storage: window.localStorage, key: 'chf_rq_cache' });

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 }}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </PersistQueryClientProvider>
  </React.StrictMode>
);
