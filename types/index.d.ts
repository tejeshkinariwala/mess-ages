export type SeenMap = Record<string, number>
/** What a message is doing: your prompt, or what Claude's reply is busy with. */
export type Kind = 'input' | 'edit' | 'read' | 'run' | 'other'
export type Label = { words: string; kind: Kind }
export type Labels = Record<string, Label>
/** A labelled run of consecutive panel rows, by message id. */
export type Group = { ids: string[]; title: string }
/**
 * The /ages panel's groups: the frozen closed ones, the open last one, how
 * many rows were shown at the last pass, and whether that pass failed (the
 * panel then draws the flat list).
 */
export type Grouping = { closed: Group[]; open?: Group; tried: number; isFlat: boolean }
/** Fold choices the person made, by group key: true is collapsed. */
export type Folds = Record<string, boolean>

declare module 'claude-code' {
  interface PluginState {
    'mess-ages': { now: number; labels: Labels; groups: Grouping; folds: Folds }
  }
}
