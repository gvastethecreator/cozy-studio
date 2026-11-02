/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STUDIO_API_BASE?: string;
}

declare module '*.yaml?raw' {
  const content: string;
  export default content;
}
