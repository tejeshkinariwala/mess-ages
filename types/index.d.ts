export type SeenMap = Record<string, number>
export type Summaries = Record<string, string>

declare module 'claude-code' {
  interface PluginState {
    'mess-ages': { now: number; summaries: Summaries }
  }
}
