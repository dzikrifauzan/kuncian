import { Component } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';
import { Router } from './router.jsx';
import { applyTheme } from './util.js';

applyTheme();

class Boundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="screen auth">
        <h1>Aduh, ada yang rusak</h1>
        <p className="muted">Tampilannya error. Muat ulang halaman, biasanya langsung beres.</p>
        <button className="btn primary" onClick={() => location.reload()}>Muat ulang</button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <Boundary>
    <Router>
      <App />
    </Router>
  </Boundary>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
