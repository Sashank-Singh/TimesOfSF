/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional public site URL for canonicals / JSON-LD when it differs from `window.location.origin` (e.g. prerender). */
  readonly VITE_PUBLIC_SITE_URL?: string;
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
