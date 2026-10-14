import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RegisterPage } from './pages/RegisterPage';

// Точка входа клиентского SPA (каркас интерфейса будет расширен в Этапе 2)
const App = () => (
  <main>
    <RegisterPage />
  </main>
);

const container = document.getElementById('root');

if (!container) {
  throw new Error('Корневой элемент #root не найден в DOM');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
