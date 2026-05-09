import type { Draw } from '../draw/Draw'
import { IDrawPagePayload } from '../../interface/Draw'
import {
  IRecordedPagePaint,
  IRenderBackend,
  IWorkerRenderMessage,
  IWorkerRenderResponse
} from '../../interface/RenderBackend'
import RenderWorker from '../worker/works/render?worker&inline'

interface IPendingRenderPage {
  pageNo: number
  renderId: number
}

const MAX_WORKER_COMMAND_COUNT = 3500

export class DomRenderBackend implements IRenderBackend {
  public readonly mode = 'dom' as const
  private draw: Draw

  constructor(draw: Draw) {
    this.draw = draw
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public resizePage(_pageNo: number, _width: number, _height: number, _dpr: number) {}

  public paintPage(payload: IDrawPagePayload) {
    this.draw.paintPageOnDom(payload)
  }

  public paintDecoration(payload: IDrawPagePayload) {
    this.draw.paintDecorationOnDom(payload)
  }

  public invalidate() {}

  public destroy() {}
}

export class WorkerOffscreenRenderBackend implements IRenderBackend {
  public readonly mode = 'worker-offscreen' as const
  private draw: Draw
  private fallback: DomRenderBackend
  private worker: Worker | null
  private renderId: number
  private latestRenderByPage: Map<number, number>
  private registeredAssetKeys: Set<string>
  private pendingPages: Map<number, IPendingRenderPage>
  private disabled: boolean

  constructor(draw: Draw, fallback: DomRenderBackend) {
    this.draw = draw
    this.fallback = fallback
    this.worker = null
    this.renderId = 0
    this.latestRenderByPage = new Map()
    this.registeredAssetKeys = new Set()
    this.pendingPages = new Map()
    this.disabled = false
    this._initWorker()
  }

  public static isSupported(): boolean {
    return (
      typeof Worker !== 'undefined' &&
      typeof OffscreenCanvas !== 'undefined' &&
      typeof createImageBitmap === 'function'
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public resizePage(pageNo: number, width: number, height: number, _dpr: number) {
    if (!this.worker || this.disabled) return
    this._postMessage({
      type: 'resize-page',
      pageNo,
      width,
      height
    })
  }

  public paintPage(payload: IDrawPagePayload) {
    // Keep selection/search/table-range on the DOM decoration layer so those
    // latency-sensitive overlays do not wait on worker round-trips.
    this.fallback.paintDecoration(payload)
    void this._renderRecordedPage(payload)
  }

  public paintDecoration(payload: IDrawPagePayload) {
    this.fallback.paintDecoration(payload)
  }

  public invalidate() {
    this.registeredAssetKeys.clear()
    if (!this.worker || this.disabled) return
    this._postMessage({
      type: 'invalidate-assets'
    })
  }

  public destroy() {
    if (this.worker) {
      this._postMessage({ type: 'dispose' })
      this.worker.terminate()
      this.worker = null
    }
  }

  private _initWorker() {
    try {
      this.worker = new RenderWorker()
      this.worker.onmessage = evt => this._handleMessage(evt.data)
      this.worker.onerror = evt => {
        this._disable(
          evt.message || 'worker-offscreen-render-backend-initialization-failed'
        )
      }
      this._postMessage({ type: 'init' })
    } catch (error) {
      this._disable(String(error))
    }
  }

  private _postMessage(message: IWorkerRenderMessage, transfer: Transferable[] = []) {
    this.worker?.postMessage(message, transfer)
  }

  private async _renderRecordedPage(payload: IDrawPagePayload) {
    if (!this.worker || this.disabled) {
      this.fallback.paintPage(payload)
      return
    }
    const recordedPage = this.draw.recordPagePaint(payload, false, true)
    if (!recordedPage) {
      this.fallback.paintPage(payload)
      return
    }
    if (recordedPage.commandCount > MAX_WORKER_COMMAND_COUNT) {
      this.fallback.paintPage(payload)
      return
    }
    // Text-only pages regress badly with the command-recording worker path:
    // they pay record + replay + bitmap copy without any asset decode savings.
    if (recordedPage.assets.length === 0) {
      this.fallback.paintPage(payload)
      return
    }
    const transferables: Transferable[] = []
    const registerAssets = []
    for (const asset of recordedPage.assets) {
      const assetKey = this._getAssetKey(asset)
      if (this.registeredAssetKeys.has(assetKey)) continue
      try {
        const bitmap = await createImageBitmap(asset.source)
        transferables.push(bitmap)
        registerAssets.push({
          assetId: asset.assetId,
          bitmap
        })
        this.registeredAssetKeys.add(assetKey)
      } catch (_error) { // eslint-disable-line @typescript-eslint/no-unused-vars
        this.fallback.paintPage(payload)
        return
      }
    }
    if (registerAssets.length) {
      this._postMessage(
        {
          type: 'register-assets',
          assets: registerAssets
        },
        transferables
      )
    }
    const renderId = ++this.renderId
    this.latestRenderByPage.set(recordedPage.pageNo, renderId)
    this.pendingPages.set(recordedPage.pageNo, {
      pageNo: recordedPage.pageNo,
      renderId
    })
    this._postMessage({
      type: 'render-page',
      renderId,
      pageNo: recordedPage.pageNo,
      base: recordedPage.base,
      decoration: recordedPage.decoration
    })
  }

  private _getAssetKey(asset: IRecordedPagePaint['assets'][number]): string {
    return asset.assetId
  }

  private _handleMessage(message: IWorkerRenderResponse) {
    if (message.type === 'render-error') {
      this._disable(message.message)
      return
    }
    if (message.type === 'render-decoration-ack') {
      message.decorationBitmap.close()
      return
    }
    const latestRenderId = this.latestRenderByPage.get(message.pageNo)
    if (latestRenderId !== message.renderId) {
      message.baseBitmap.close()
      message.decorationBitmap?.close()
      return
    }
    this.pendingPages.delete(message.pageNo)
    this.draw.presentWorkerBitmaps(
      message.pageNo,
      message.baseBitmap,
      message.decorationBitmap
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _disable(_reason: string) {
    this.disabled = true
    this.worker?.terminate()
    this.worker = null
    this.pendingPages.clear()
    this.draw.useDomRenderBackend()
  }
}
