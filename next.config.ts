import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

// Raíz explícita: si hay otro package-lock.json en un padre (p. ej. el perfil de usuario),
// Turbopack puede elegir mal y compilación dev queda colgada o muy lenta.
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  serverExternalPackages: ["web-push"],
  turbopack: {
    root: projectRoot,
  },
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 7,
  },
  async redirects() {
    return [
      {
        source: "/favicon.ico",
        destination: "/favicon-64.png?v=4",
        permanent: false,
      },
      {
        source: "/tratamientos",
        destination: "/servicios",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
