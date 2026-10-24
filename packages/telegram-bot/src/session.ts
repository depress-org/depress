import { randomUUID } from 'node:crypto'

export interface ChatState {
  generation: string
  stage: 'idle' | 'uploading' | 'awaiting_sql' | 'awaiting_media' | 'awaiting_theme' | 'starting' | 'running'
  uploadDir?: string
  wxrPath?: string
  sqlDumpPath?: string
  mediaDir?: string
  jobId?: string
}
/** Only the adapter can establish an authorized chat:sender key. */
export class SessionStore {
  private sessions = new Map<string, ChatState>()
  get(key: string): ChatState {
    let state = this.sessions.get(key)
    if (!state) { state = { generation: randomUUID(), stage: 'idle' }; this.sessions.set(key, state) }
    return state
  }
  current(key: string, state: ChatState): boolean { return this.sessions.get(key) === state }
  reset(key: string): ChatState {
    const state: ChatState = { generation: randomUUID(), stage: 'idle' }
    this.sessions.set(key, state)
    return state
  }
}
