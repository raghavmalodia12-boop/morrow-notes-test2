import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local dev: the Vite server proxies API and upload requests to the Express server.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:5002",
      "/uploads": "http://localhost:5002"
    }
  }
});
