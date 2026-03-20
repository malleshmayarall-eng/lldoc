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
