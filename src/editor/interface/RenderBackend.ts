import { IDrawPagePayload } from './Draw'

export type EditorRenderBackend = 'dom' | 'worker-offscreen' | 'auto'
export type EditorRenderBackendFallback = 'dom'
export type EditorRenderWorkerScope = 'all-possible'

export interface IRenderBackend {
  readonly mode: 'dom' | 'worker-offscreen'
  resizePage(pageNo: number, width: number, height: number, dpr: number): void
  paintPage(payload: IDrawPagePayload): void
  paintDecoration(payload: IDrawPagePayload): void
  invalidate(): void
  destroy(): void
}

export interface IRenderAssetRef {
  kind: 'asset'
  assetId: string
}

export interface IRenderPatternRef {
  kind: 'pattern'
  assetId: string
  repetition: string | null
}

export type IRenderSerializable =
  | null
  | boolean
  | number
  | string
  | number[]
  | IRenderAssetRef
  | IRenderPatternRef

export interface IRenderCommandSet {
  kind: 'set'
  property: string
  value: IRenderSerializable
}

export interface IRenderCommandCall {
  kind: 'call'
  method: string
  args: IRenderSerializable[]
}

export type IRenderCommand = IRenderCommandSet | IRenderCommandCall

export interface IRecordedRenderFrame {
  width: number
  height: number
  commands: IRenderCommand[]
}

export interface IRecordedRenderAsset {
  assetId: string
  source: CanvasImageSource
}

export interface IRecordedPagePaint {
  pageNo: number
  base: IRecordedRenderFrame
  decoration: IRecordedRenderFrame | null
  assets: IRecordedRenderAsset[]
  commandCount: number
}

export interface IWorkerRenderInitMessage {
  type: 'init'
}

export interface IWorkerRenderDisposeMessage {
  type: 'dispose'
}

export interface IWorkerRenderResizeMessage {
  type: 'resize-page'
  pageNo: number
  width: number
  height: number
}

export interface IWorkerRegisterAssetsMessage {
  type: 'register-assets'
  assets: Array<{
    assetId: string
    bitmap: ImageBitmap
  }>
}

export interface IWorkerInvalidateAssetsMessage {
  type: 'invalidate-assets'
  assetIds?: string[]
}

export interface IWorkerRenderPageMessage {
  type: 'render-page'
  renderId: number
  pageNo: number
  base: IRecordedRenderFrame
  decoration: IRecordedRenderFrame | null
}

export interface IWorkerRenderDecorationMessage {
  type: 'render-decoration'
  renderId: number
  pageNo: number
  decoration: IRecordedRenderFrame
}

export interface IWorkerRenderAckMessage {
  type: 'render-ack'
  renderId: number
  pageNo: number
  baseBitmap: ImageBitmap
  decorationBitmap: ImageBitmap | null
}

export interface IWorkerRenderDecorationAckMessage {
  type: 'render-decoration-ack'
  renderId: number
  pageNo: number
  decorationBitmap: ImageBitmap
}

export interface IWorkerRenderErrorMessage {
  type: 'render-error'
  renderId?: number
  pageNo?: number
  message: string
}

export type IWorkerRenderMessage =
  | IWorkerRenderInitMessage
  | IWorkerRenderDisposeMessage
  | IWorkerRenderResizeMessage
  | IWorkerRegisterAssetsMessage
  | IWorkerInvalidateAssetsMessage
  | IWorkerRenderPageMessage
  | IWorkerRenderDecorationMessage

export type IWorkerRenderResponse =
  | IWorkerRenderAckMessage
  | IWorkerRenderDecorationAckMessage
  | IWorkerRenderErrorMessage
