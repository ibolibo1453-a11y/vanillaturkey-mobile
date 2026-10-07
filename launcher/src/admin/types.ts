export interface ApiRes { status: number; data: any }
/** What the admin panel needs from its host (launcher: IPC, PWA: fetch). Always authenticated as the logged-in user. */
export interface PanelApi {
  call(method: string, path: string, body?: any): Promise<ApiRes>
  upload(path: string, file: File): Promise<ApiRes>
}
export interface AdminMe { ok: boolean; role: string | null; canAdmin: boolean; sections: { id: string; label: string }[] }
