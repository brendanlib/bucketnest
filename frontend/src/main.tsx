import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './api/client';
import { App } from './App';
import { ToastProvider } from './components/Toast';
import { applyTheme, watchSystemTheme } from './lib/theme';
import { ROUTER_BASENAME } from './lib/basePath';
import './theme/global.css';

applyTheme();
watchSystemTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

async function start() {
  // The website's read-only demo answers the API in the browser (see src/static-demo).
  if (import.meta.env.VITE_STATIC_DEMO === 'true') {
    const { installStaticDemo } = await import('./static-demo/install');
    await installStaticDemo();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename={ROUTER_BASENAME}>
          <ToastProvider>
            <App />
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void start();
