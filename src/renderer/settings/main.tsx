import { createRoot } from 'react-dom/client';

function App() {
  return <h1>Settings</h1>;
}

const el = document.getElementById('root');
if (el) createRoot(el).render(<App />);
