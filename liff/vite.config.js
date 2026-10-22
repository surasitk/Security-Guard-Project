import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// prod → /Security-Guard-Project/app/ · staging (vite build --mode staging) → /Security-Guard-Project/staging/app/
export default defineConfig(({ mode }) => ({
  base: mode === 'staging' ? '/Security-Guard-Project/staging/app/' : '/Security-Guard-Project/app/',
  plugins: [react()],
}))
