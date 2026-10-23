/**
 * Per-chat conversation state for the migrate->deploy flow.
 *
 * idle          -> waiting for a WXR file
 * awaiting_sql  -> WXR received, waiting for an optional SQL dump or /skip
 * awaiting_theme-> waiting for a theme choice (inline keyboard)
 * running       -> job queued/migrating/building/deploying
 */
export type ChatState =
  | { stage: 'idle' }
  | { stage: 'awaiting_sql'; wxrPath: string }
  | { stage: 'awaiting_theme'; wxrPath: string; sqlDumpPath?: string }
  | { stage: 'running'; jobId: string }

export class SessionStore {
  private sessions = new Map<number, ChatState>()

  get(chatId: number): ChatState {
    return this.sessions.get(chatId) ?? { stage: 'idle' }
  }

  set(chatId: number, state: ChatState): void {
    this.sessions.set(chatId, state)
  }

  reset(chatId: number): void {
    this.sessions.set(chatId, { stage: 'idle' })
  }
}
