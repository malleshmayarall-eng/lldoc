import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext'
import { FeatureFlagProvider } from './contexts/FeatureFlagContext'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <FeatureFlagProvider>
        <App />
      </FeatureFlagProvider>
    </AuthProvider>
  </StrictMode>,
)

// Remove the splash element inserted into index.html once React has mounted
try {
  const removeSplash = () => {
    const s = document.getElementById('splash');
    if (!s) return;
    s.style.opacity = '0';
    setTimeout(() => {
      s.remove();
    }, 350);
  };

  // Defer removal slightly to ensure the app's first paint is visible
  window.requestAnimationFrame(() => setTimeout(removeSplash, 50));
} catch (e) {
  // ignore
}
