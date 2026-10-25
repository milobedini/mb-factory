// Turbopack imports YAML as text (see `next.config.ts`).
declare module '*.yaml' {
  const source: string;
  export default source;
}
