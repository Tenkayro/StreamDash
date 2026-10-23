import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { RuntimeProvider } from './services/runtime'
import { Toaster } from 'sonner'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RuntimeProvider><App /><Toaster theme="dark" position="bottom-right" richColors /></RuntimeProvider>
  </StrictMode>,
)
