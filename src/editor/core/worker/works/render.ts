import {
  IRenderCommand,
  IRenderAssetRef,
  IRenderPatternRef,
  IRenderSerializable,
  IWorkerRenderMessage,
  IWorkerRenderResponse
} from '../../../interface/RenderBackend'

const baseSurfaceMap = new Map<number, OffscreenCanvas>()
const decorationSurfaceMap = new Map<number, OffscreenCanvas>()
const assetMap = new Map<string, ImageBitmap>()
const workerScope = self as typeof globalThis & {
  postMessage: (message: unknown, transfer?: Transferable[]) => void
}

function isAssetRef(
  value: IRenderSerializable
): value is IRenderAssetRef {
  return !!value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'asset'
}

function isPatternRef(
  value: IRenderSerializable
): value is IRenderPatternRef {
  return !!value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'pattern'
}

function getSurface(
  map: Map<number, OffscreenCanvas>,
  pageNo: number,
  width: number,
  height: number
) {
  const surface = map.get(pageNo)
  if (surface && surface.width === width && surface.height === height) {
    return surface
  }
  const nextSurface = new OffscreenCanvas(width, height)
  map.set(pageNo, nextSurface)
  return nextSurface
}

function resolveValue(value: IRenderSerializable) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  if (isAssetRef(value)) {
    return assetMap.get(value.assetId) ?? null
  }
  return value
}

function applyPattern(ctx: OffscreenCanvasRenderingContext2D, value: IRenderPatternRef) {
  const asset = assetMap.get(value.assetId)
  if (!asset) return null
  return ctx.createPattern(asset, value.repetition)
}

function replay(
  ctx: OffscreenCanvasRenderingContext2D,
  commands: IRenderCommand[]
) {
  for (const command of commands) {
    if (command.kind === 'set') {
      const value = command.value
      if (
        isPatternRef(value)
      ) {
        ;((ctx as unknown) as Record<string, unknown>)[command.property] =
          applyPattern(ctx, value) ?? null
      } else {
        ;((ctx as unknown) as Record<string, unknown>)[command.property] =
          resolveValue(value)
      }
      continue
    }
    const method = ((ctx as unknown) as Record<string, unknown>)[command.method]
    if (typeof method !== 'function') continue
    const args = command.args.map(arg => {
      if (isPatternRef(arg)) {
        return applyPattern(ctx, arg)
      }
      return resolveValue(arg)
    })
    ;(method as (...methodArgs: unknown[]) => void).apply(ctx, args)
  }
}

function postError(message: string, renderId?: number, pageNo?: number) {
  const payload: IWorkerRenderResponse = {
    type: 'render-error',
    message,
    renderId,
    pageNo
  }
  workerScope.postMessage(payload)
}

onmessage = evt => {
  const message = evt.data as IWorkerRenderMessage
  try {
    if (message.type === 'dispose') {
      assetMap.forEach(asset => asset.close())
      assetMap.clear()
      baseSurfaceMap.clear()
      decorationSurfaceMap.clear()
      return
    }
    if (message.type === 'register-assets') {
      message.assets.forEach(asset => {
        assetMap.set(asset.assetId, asset.bitmap)
      })
      return
    }
    if (message.type === 'invalidate-assets') {
      if (!message.assetIds?.length) {
        assetMap.forEach(asset => asset.close())
        assetMap.clear()
        return
      }
      message.assetIds.forEach(assetId => {
        assetMap.get(assetId)?.close()
        assetMap.delete(assetId)
      })
      return
    }
    if (message.type === 'resize-page') {
      getSurface(baseSurfaceMap, message.pageNo, message.width, message.height)
      getSurface(
        decorationSurfaceMap,
        message.pageNo,
        message.width,
        message.height
      )
      return
    }
    if (message.type === 'render-decoration') {
      const decorationSurface = getSurface(
        decorationSurfaceMap,
        message.pageNo,
        message.decoration.width,
        message.decoration.height
      )
      const decorationCtx = decorationSurface.getContext('2d')
      if (!decorationCtx) {
        postError(
          'decoration-context-unavailable',
          message.renderId,
          message.pageNo
        )
        return
      }
      replay(decorationCtx, message.decoration.commands)
      const decorationBitmap = decorationSurface.transferToImageBitmap()
      const payload: IWorkerRenderResponse = {
        type: 'render-decoration-ack',
        renderId: message.renderId,
        pageNo: message.pageNo,
        decorationBitmap
      }
      workerScope.postMessage(payload, [decorationBitmap])
      return
    }
    if (message.type !== 'render-page') return
    const baseSurface = getSurface(
      baseSurfaceMap,
      message.pageNo,
      message.base.width,
      message.base.height
    )
    const baseCtx = baseSurface.getContext('2d')
    if (!baseCtx) {
      postError('base-context-unavailable', message.renderId, message.pageNo)
      return
    }
    replay(baseCtx, message.base.commands)
    let decorationBitmap: ImageBitmap | null = null
    if (message.decoration) {
      const decorationSurface = getSurface(
        decorationSurfaceMap,
        message.pageNo,
        message.decoration.width,
        message.decoration.height
      )
      const decorationCtx = decorationSurface.getContext('2d')
      if (!decorationCtx) {
        postError(
          'decoration-context-unavailable',
          message.renderId,
          message.pageNo
        )
        return
      }
      replay(decorationCtx, message.decoration.commands)
      decorationBitmap = decorationSurface.transferToImageBitmap()
    }
    const payload: IWorkerRenderResponse = {
      type: 'render-ack',
      renderId: message.renderId,
      pageNo: message.pageNo,
      baseBitmap: baseSurface.transferToImageBitmap(),
      decorationBitmap
    }
    const transfer: Transferable[] = [payload.baseBitmap]
    if (payload.decorationBitmap) {
      transfer.push(payload.decorationBitmap)
    }
    workerScope.postMessage(payload, transfer)
  } catch (error) {
    postError(
      String(error),
      message.type === 'render-page' || message.type === 'render-decoration'
        ? message.renderId
        : undefined,
      message.type === 'render-page' || message.type === 'render-decoration'
        ? message.pageNo
        : undefined
    )
  }
}
