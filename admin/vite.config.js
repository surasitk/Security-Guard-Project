import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// prod → /Security-Guard-Project/admin/ · staging (vite build --mode staging) → /Security-Guard-Project/staging/admin/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'staging' ? '/Security-Guard-Project/staging/admin/' : '/Security-Guard-Project/admin/',
}))
