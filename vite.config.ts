import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev`        -> http://localhost:5173 (GPS funciona em localhost)
// `npm run dev:https`  -> https://<ip-da-maquina>:5173 (necessário para GPS no celular via Wi-Fi)
export default defineConfig(({ mode }) => ({
  plugins: mode === 'https' ? [basicSsl()] : [],
  server: { port: 5173, host: true },
}));
