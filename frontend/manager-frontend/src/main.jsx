import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.jsx';
import { PanelUX } from './ui/PanelUX';
import './ui/manager-region.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <PanelUX.FeedbackHost />
    </BrowserRouter>
  </StrictMode>,
);
