import {
  IRecordedPagePaint,
  IRenderAssetRef,
  IRenderCommand,
  IRenderPatternRef,
  IRenderSerializable
} from '../../interface/RenderBackend'

type PatternToken = IRenderPatternRef & {
  __cePatternToken: true
}

const COMMANDLESS_METHODS = new Set([
  'measureText',
  'isPointInPath',
  'isPointInStroke',
  'getTransform',
  'getLineDash'
])

const STATEFUL_PASSTHROUGH_METHODS = new Set(['save', 'restore'])

const GLOBAL_ASSET_IDS = new WeakMap<object, string>()
let GLOBAL_ASSET_ID_SEQ = 0

function isCanvasImageSource(value: unknown): value is CanvasImageSource {
  if (!value || typeof value !== 'object') return false
  return (
    value instanceof HTMLImageElement ||
    value instanceof HTMLCanvasElement ||
    (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) ||
    value instanceof SVGImageElement ||
    (typeof OffscreenCanvas !== 'undefined' &&
      value instanceof OffscreenCanvas) ||
    value instanceof HTMLVideoElement
  )
}

export class CanvasCommandRecorder {
  private width: number
  private height: number
  private pageNo: number
  private ctx: CanvasRenderingContext2D
  private commands: IRenderCommand[]
  private assetIds: WeakMap<object, string>
  private assets: Map<string, CanvasImageSource>
  private unsupportedReason: string | null
  private proxy: CanvasRenderingContext2D

  constructor(pageNo: number, width: number, height: number) {
    this.pageNo = pageNo
    this.width = width
    this.height = height
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    this.commands = []
    this.assetIds = new WeakMap()
    this.assets = new Map()
    this.unsupportedReason = null
    this.proxy = this._createProxy()
  }

  public getContext(): CanvasRenderingContext2D {
    return this.proxy
  }

  public getUnsupportedReason(): string | null {
    return this.unsupportedReason
  }

  public getRecording() {
    return {
      width: this.width,
      height: this.height,
      commands: this.commands
    }
  }

  public getAssets() {
    return Array.from(this.assets.entries()).map(([assetId, source]) => ({
      assetId,
      source
    }))
  }

  public toRecordedPagePaint(
    decoration: CanvasCommandRecorder | null
  ): IRecordedPagePaint {
    const assets = [...this.getAssets()]
    if (decoration) {
      assets.push(
        ...decoration
          .getAssets()
          .filter(asset => !assets.some(entry => entry.assetId === asset.assetId))
      )
    }
    return {
      pageNo: this.pageNo,
      base: this.getRecording(),
      decoration: decoration?.getRecording() ?? null,
      assets,
      commandCount:
        this.commands.length + (decoration?.getRecording().commands.length ?? 0)
    }
  }

  private _markUnsupported(reason: string) {
    if (!this.unsupportedReason) {
      this.unsupportedReason = reason
    }
  }

  private _createAssetRef(source: CanvasImageSource): IRenderAssetRef | null {
    if (source instanceof HTMLImageElement && !source.complete) {
      this._markUnsupported('image-not-ready')
      return null
    }
    if (source instanceof HTMLVideoElement && source.readyState < 2) {
      this._markUnsupported('video-not-ready')
      return null
    }
    const objectRef = source as unknown as object
    let assetId = this.assetIds.get(objectRef)
    if (!assetId) {
      assetId = GLOBAL_ASSET_IDS.get(objectRef) || ''
      if (!assetId) {
        assetId = `shared-asset-${GLOBAL_ASSET_ID_SEQ++}`
        GLOBAL_ASSET_IDS.set(objectRef, assetId)
      }
      this.assetIds.set(objectRef, assetId)
      this.assets.set(assetId, source)
    }
    return {
      kind: 'asset',
      assetId
    }
  }

  private _serialize(value: unknown): IRenderSerializable {
    if (
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'number' ||
      typeof value === 'string'
    ) {
      return value
    }
    if (Array.isArray(value) && value.every(item => typeof item === 'number')) {
      return value
    }
    if (value && typeof value === 'object') {
      const pattern = value as PatternToken
      if (pattern.__cePatternToken) {
        return {
          kind: 'pattern',
          assetId: pattern.assetId,
          repetition: pattern.repetition
        }
      }
      if (isCanvasImageSource(value)) {
        const asset = this._createAssetRef(value)
        if (asset) return asset
      }
    }
    this._markUnsupported(`unsupported-value:${typeof value}`)
    return null
  }

  private _createPattern(
    source: CanvasImageSource,
    repetition: string | null
  ): PatternToken | null {
    const asset = this._createAssetRef(source)
    if (!asset) return null
    return {
      __cePatternToken: true,
      kind: 'pattern',
      assetId: asset.assetId,
      repetition
    }
  }

  private _createProxy(): CanvasRenderingContext2D {
    const target = this.ctx
    const handler: ProxyHandler<CanvasRenderingContext2D> = {
      get: (ctx, prop) => {
        if (prop === 'createPattern') {
          return (
            source: CanvasImageSource,
            repetition: string | null
          ): PatternToken | null => {
            const pattern = this._createPattern(source, repetition)
            if (!pattern) {
              this._markUnsupported('pattern-asset')
              return null
            }
            return pattern
          }
        }
        const value = ctx[prop as keyof CanvasRenderingContext2D]
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          if (COMMANDLESS_METHODS.has(String(prop))) {
            return (value as (...methodArgs: unknown[]) => unknown).apply(
              target,
              args
            )
          }
          if (STATEFUL_PASSTHROUGH_METHODS.has(String(prop))) {
            this.commands.push({
              kind: 'call',
              method: String(prop),
              args: args.map(arg => this._serialize(arg))
            })
            return (value as (...methodArgs: unknown[]) => unknown).apply(
              target,
              args
            )
          }
          if (prop === 'drawImage') {
            const [source, ...rest] = args
            if (!isCanvasImageSource(source)) {
              this._markUnsupported('draw-image-source')
              return
            }
            const asset = this._createAssetRef(source)
            if (!asset) return
            this.commands.push({
              kind: 'call',
              method: 'drawImage',
              args: [asset, ...rest.map(arg => this._serialize(arg))]
            })
            return
          }
          if (
            prop === 'createLinearGradient' ||
            prop === 'createRadialGradient'
          ) {
            this._markUnsupported(String(prop))
          }
          this.commands.push({
            kind: 'call',
            method: String(prop),
            args: args.map(arg => this._serialize(arg))
          })
          return
        }
      },
      set: (ctx, prop, value) => {
        const serialized = this._serialize(value)
        this.commands.push({
          kind: 'set',
          property: String(prop),
          value: serialized
        })
        if (
          value &&
          typeof value === 'object' &&
          (value as PatternToken).__cePatternToken
        ) {
          return true
        }
        ;((ctx as unknown) as Record<string, unknown>)[String(prop)] = value
        return true
      }
    }
    return new Proxy(target, handler)
  }
}
