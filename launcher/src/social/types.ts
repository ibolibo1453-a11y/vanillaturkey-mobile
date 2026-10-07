// Shared types of the social layer (plans/SOCIAL.md). No DOM / Electron imports: reused by the PWA.
export type Access = 'public' | 'friends' | 'password'
export interface RoomMember { name: string; speaking?: boolean; muted?: boolean; deafened?: boolean; vtRole?: string | null }
export interface Room { id: string; name: string; icon?: string; access: Access; owner: string; members: RoomMember[]; max: number; createdAt?: number }
export interface Attachment { id: string; kind: 'image' | 'audio'; url: string; thumbUrl?: string; durationMs?: number }
export interface ReplyRef { id: string; author?: string; text?: string }
export interface Message {
  id: string; channel: string; author: string; text: string; attachment?: Attachment; replyTo?: ReplyRef | string | null
  reactions: Record<string, string[]>; createdAt: number; pending?: boolean; failed?: boolean; tempId?: string; authorRole?: string | null
}
export interface DmEntry { name: string; lastMessage?: string; unread: number }
export interface FriendEntry { name: string; online: boolean; status?: string; vtRole?: string | null }
export interface ApiRes { status: number; data: any; networkError?: boolean }
export interface ToastItem { id: number; channel: string; title: string; body: string; kind: 'dm' | 'room' | 'friend' | 'info'; at: number; from?: string }
export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'
export interface VoiceMemberState { name: string; speaking: boolean; muted: boolean; deafened: boolean; quality?: 'excellent' | 'good' | 'poor' | 'lost' | 'unknown'; volume: number }

export type NoisePreset = 'off' | 'low' | 'medium' | 'high'
/** Persisted + game-synced voice settings (launcher settings.json -> `voice`). Key strings: see keys.ts */
export interface VoicePrefs {
  inputDevice: string; outputDevice: string; inputVolume: number; outputVolume: number
  mode: 'vad' | 'ptt'; vadThreshold: number // 0..100 (maps to -70..-10 dBFS)
  noiseSuppression: boolean; echoCancellation: boolean; autoGain: boolean
  noisePreset: NoisePreset // "Ses kirliliği engelleme": RNNoise + voice-aware gate (off = level-only gate, legacy)
  keyPtt: string; keyMute: string; keyDeafen: string; keyChat: string
  joinSounds: boolean; notifSounds: boolean; userVolumes: Record<string, number>; mutedUsers: string[]
}
export const DEFAULT_VOICE: VoicePrefs = {
  inputDevice: '', outputDevice: '', inputVolume: 100, outputVolume: 100, mode: 'vad', vadThreshold: 35,
  noiseSuppression: true, echoCancellation: true, autoGain: true, noisePreset: 'medium', keyPtt: 'V', keyMute: 'CTRL+M', keyDeafen: 'CTRL+D', keyChat: 'N',
  joinSounds: true, notifSounds: true, userVolumes: {}, mutedUsers: []
}

/** What the social UI needs from its host. Electron: IPC to main. PWA: fetch + localStorage. */
export interface SocialAdapter {
  platform: 'electron' | 'web'
  /** Signed-in account name, '' when logged out / offline account. */
  me(): string
  api(method: string, path: string, body?: any): Promise<ApiRes>
  /** multipart upload to POST /v1/uploads */
  upload(data: ArrayBuffer, name: string, type: string): Promise<ApiRes>
  /** ws url incl. token, or null when not signed in */
  wsUrl(): Promise<string | null>
  /** absolute URL of a media path returned by the server */
  mediaUrl(p: string): string
  /** URL or data URL of the player's skin (server skin system); never rejects */
  skin(name: string): Promise<string | null>
  invalidateSkin?(name: string): void
  /** fallback when the webview cannot load a media URL directly: returns a data URL */
  mediaData?(url: string): Promise<string | null>
  loadPrefs(): Promise<Partial<VoicePrefs>>
  savePrefs(p: VoicePrefs): void
  /** OS notification (only called when the app is not visible) */
  osNotify?(n: { title: string; body: string; channel: string }): void
  setBadge?(n: number): void
  /** voice room membership changed (keep-alive in tray) */
  setInRoom?(v: boolean): void
  /** register global keybinds (PTT/mute/deafen) */
  setKeys?(keys: Record<string, string>): void
  /** is the app window visible and focused? (decides in-app toast vs OS notification) */
  isActive(): boolean
  /** subscribe to host events: global key events, "open this conversation", visibility */
  onHost?(cb: (ev: { type: 'key'; action: 'ptt' | 'mute' | 'deafen'; down?: boolean } | { type: 'open'; channel: string }) => void): () => void
  openExternal?(url: string): void
}
