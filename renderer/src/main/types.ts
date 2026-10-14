// Types shared by the main process modules. Mirrors docs/api.md, "Graphics (EBU OGraf)".

export interface Format {
  width: number
  height: number
  fps: number
}

export interface CustomActionInfo {
  id: string
  name: string
  description?: string
  schema?: object
}

export interface GraphicInfo {
  id: string
  name: string
  description: string
  path: string
  schema: object | null
  stepCount: number
  customActions: CustomActionInfo[]
}

export type LayerStatus = 'empty' | 'loading' | 'ready' | 'playing' | 'stopped' | 'error'

export interface LayerState {
  layer: number
  graphicId: string | null
  status: LayerStatus
  step: number
  error: string | null
}

export interface PlayParams {
  delta?: number
  goto?: number
  skipAnimation?: boolean
}

export interface StopParams {
  skipAnimation?: boolean
}
