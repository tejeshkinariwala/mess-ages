export type SeenMap = Record<string, number>
/** What a message is doing: your prompt, or what Claude's reply is busy with. */
export type Kind = 'input' | 'edit' | 'read' | 'run' | 'other'
export type Label = { words: string; kind: Kind }
export type Labels = Record<string, Label>

declare module 'claude-code' {
  interface PluginState {
    'mess-ages': { now: number; labels: Labels }
  }
}
