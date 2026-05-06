import { EDITOR_PREFIX } from '../../../dataset/constant/Editor'
import { ImageDisplay } from '../../../dataset/enum/Common'
import { ElementType } from '../../../dataset/enum/Element'
import { DeepRequired } from '../../../interface/Common'
import { IEditorOption } from '../../../interface/Editor'
import { IElement } from '../../../interface/Element'
import { convertStringToBase64 } from '../../../utils'
import { Draw } from '../Draw'

export class ImageParticle {
  private draw: Draw
  protected options: DeepRequired<IEditorOption>
  protected imageCache: Map<string, HTMLImageElement>
  private container: HTMLDivElement
  private floatImageContainer: HTMLDivElement | null
  private floatImage: HTMLImageElement | null

  constructor(draw: Draw) {
    this.draw = draw
    this.options = draw.getOptions()
    this.container = draw.getContainer()
    this.imageCache = new Map()
    this.floatImageContainer = null
    this.floatImage = null
  }

  public getOriginalMainImageList(): IElement[] {
    const imageList: IElement[] = []
    const getImageList = (elementList: IElement[]) => {
      for (const element of elementList) {
        if (element.type === ElementType.TABLE) {
          const trList = element.trList!
          for (let r = 0; r < trList.length; r++) {
            const tr = trList[r]
            for (let d = 0; d < tr.tdList.length; d++) {
              const td = tr.tdList[d]
              getImageList(td.value)
            }
          }
        } else if (element.type === ElementType.IMAGE) {
          imageList.push(element)
        }
      }
    }
    // 获取正文图片列表
    getImageList(this.draw.getOriginalMainElementList())
    return imageList
  }

  private _countImagesBeforeTarget(
    elementList: IElement[],
    targetElement: IElement
  ): number {
    let count = 0
    for (const element of elementList) {
      if (element === targetElement) break
      if (element.type === ElementType.TABLE) {
        const trList = element.trList!
        for (const tr of trList) {
          for (const td of tr.tdList) {
            count += this._countImagesBeforeTarget(td.value, targetElement)
          }
        }
      } else if (element.type === ElementType.IMAGE) {
        count++
      }
    }
    return count
  }

  public createFloatImage(element: IElement) {
    const { scale } = this.options
    // 复用浮动元素
    let floatImageContainer = this.floatImageContainer
    let floatImage = this.floatImage
    if (!floatImageContainer) {
      floatImageContainer = document.createElement('div')
      floatImageContainer.classList.add(`${EDITOR_PREFIX}-float-image`)
      this.container.append(floatImageContainer)
      this.floatImageContainer = floatImageContainer
    }
    if (!floatImage) {
      floatImage = document.createElement('img')
      floatImageContainer.append(floatImage)
      this.floatImage = floatImage
    }
    floatImageContainer.style.display = 'none'
    floatImage.style.width = `${element.width! * scale}px`
    floatImage.style.height = `${element.height! * scale}px`
    // 浮动图片初始信息
    const height = this.draw.getHeight()
    const pageGap = this.draw.getPageGap()
    const preY = this.draw.getPageNo() * (height + pageGap)
    const imgFloatPosition = element.imgFloatPosition!
    floatImageContainer.style.left = `${imgFloatPosition.x * scale}px`
    floatImageContainer.style.top = `${preY + imgFloatPosition.y * scale}px`
    floatImage.src = element.value
  }

  public dragFloatImage(movementX: number, movementY: number) {
    if (!this.floatImageContainer) return
    this.floatImageContainer.style.display = 'block'
    // 之前的坐标加移动长度
    const x = parseFloat(this.floatImageContainer.style.left) + movementX
    const y = parseFloat(this.floatImageContainer.style.top) + movementY
    this.floatImageContainer.style.left = `${x}px`
    this.floatImageContainer.style.top = `${y}px`
  }

  public destroyFloatImage() {
    if (this.floatImageContainer) {
      this.floatImageContainer.style.display = 'none'
    }
  }

  protected addImageObserver(promise: Promise<unknown>) {
    this.draw.getImageObserver().add(promise)
  }

  protected getFallbackImage(width: number, height: number): HTMLImageElement {
    const tileSize = 8
    const x = (width - Math.ceil(width / tileSize) * tileSize) / 2
    const y = (height - Math.ceil(height / tileSize) * tileSize) / 2
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
                  <rect width="${width}" height="${height}" fill="url(#mosaic)" />
                  <defs>
                    <pattern id="mosaic" x="${x}" y="${y}" width="${
                      tileSize * 2
                    }" height="${tileSize * 2}" patternUnits="userSpaceOnUse">
                      <rect width="${tileSize}" height="${tileSize}" fill="#cccccc" />
                      <rect width="${tileSize}" height="${tileSize}" fill="#cccccc" transform="translate(${tileSize}, ${tileSize})" />
                    </pattern>
                  </defs>
                </svg>`
    const fallbackImage = new Image()
    fallbackImage.src = `data:image/svg+xml;base64,${convertStringToBase64(
      svg
    )}`
    return fallbackImage
  }

  private _drawImageWithCrop(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    element: IElement,
    x: number,
    y: number,
    width: number,
    height: number
  ) {
    if (element.imgCrop) {
      const {
        x: cropX,
        y: cropY,
        width: cropWidth,
        height: cropHeight
      } = element.imgCrop
      ctx.drawImage(
        img,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        x,
        y,
        width,
        height
      )
    } else {
      ctx.drawImage(img, x, y, width, height)
    }
  }

  private _renderCaption(
    ctx: CanvasRenderingContext2D,
    element: IElement,
    x: number,
    y: number,
    width: number,
    height: number
  ) {
    if (!element.imgCaption?.value) return
    const { scale, imgCaption } = this.options
    let captionText = element.imgCaption.value
    // 替换特殊字符
    if (captionText.includes('{imageNo}')) {
      const elementList = this.draw.getOriginalMainElementList()
      const imageNo = this._countImagesBeforeTarget(elementList, element) + 1
      captionText = captionText.replace(/\{imageNo\}/g, String(imageNo))
    }
    const fontSize = (element.imgCaption.size || imgCaption.size) * scale
    const fontFamily = element.imgCaption.font || imgCaption.font
    const color = element.imgCaption.color || imgCaption.color
    ctx.save()
    ctx.font = `${fontSize}px ${fontFamily}`
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    // 超出图片宽度后省略
    let displayText = captionText
    const textMetrics = ctx.measureText(captionText)
    if (textMetrics.width > width) {
      let left = 0
      let right = captionText.length
      while (left < right) {
        const mid = Math.ceil((left + right) / 2)
        const truncated = captionText.substring(0, mid)
        if (ctx.measureText(truncated + '...').width <= width) {
          left = mid
        } else {
          right = mid - 1
        }
      }
      displayText = captionText.substring(0, left) + '...'
    }
    const captionTop = (element.imgCaption.top ?? imgCaption.top) * scale
    const captionY =
      y + height + captionTop + textMetrics.actualBoundingBoxAscent
    const captionX = x + width / 2
    ctx.fillText(displayText, captionX, captionY)
    ctx.restore()
  }

  public static FIGURE_LABEL_GAP = 6
  public static FIGURE_DESCRIPTION_GAP = 8

  public isFigure(element: IElement): boolean {
    return (
      element.type === ElementType.IMAGE &&
      (!!element.imgFigureLabel ||
        !!element.imgFigureCaption ||
        !!element.imgFigureDescription)
    )
  }

  public getFigureLabelHeight(element: IElement): number {
    if (!this.isFigure(element)) return 0
    const { scale, imgCaption } = this.options
    const fontSize = imgCaption.size + 2
    return (fontSize + ImageParticle.FIGURE_LABEL_GAP) * scale
  }

  public getFigureDescriptionHeight(element: IElement): number {
    if (!element.imgFigureDescription) return 0
    const { scale, imgCaption } = this.options
    return (imgCaption.size + ImageParticle.FIGURE_DESCRIPTION_GAP) * scale
  }

  private _renderFigureLabel(
    ctx: CanvasRenderingContext2D,
    element: IElement,
    x: number,
    y: number,
    width: number
  ) {
    if (!this.isFigure(element)) return
    const { scale, imgCaption } = this.options
    const elementList = this.draw.getOriginalMainElementList()
    const imageNo = this._countImagesBeforeTarget(elementList, element) + 1
    const fontSize = (imgCaption.size + 2) * scale
    const fontFamily = imgCaption.font
    const labelGap = ImageParticle.FIGURE_LABEL_GAP * scale
    const prefix = element.imgFigureLabel
      ? `${element.imgFigureLabel} `
      : `Figure ${imageNo}. `
    ctx.save()
    ctx.font = `bold ${fontSize}px ${fontFamily}`
    ctx.fillStyle = '#000000'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    const prefixMetrics = ctx.measureText(prefix)
    const labelY = y - labelGap - prefixMetrics.actualBoundingBoxDescent
    ctx.fillText(prefix, x, labelY)
    ctx.font = `${fontSize}px ${fontFamily}`
    let captionText = element.imgFigureCaption || ''
    const maxWidth = width - prefixMetrics.width
    const captionMetrics = ctx.measureText(captionText)
    if (captionMetrics.width > maxWidth && maxWidth > 0) {
      let left = 0
      let right = captionText.length
      while (left < right) {
        const mid = Math.ceil((left + right) / 2)
        const truncated = captionText.substring(0, mid)
        if (ctx.measureText(truncated + '...').width <= maxWidth) {
          left = mid
        } else {
          right = mid - 1
        }
      }
      captionText = captionText.substring(0, left) + '...'
    }
    if (captionText) {
      ctx.fillText(captionText, x + prefixMetrics.width, labelY)
    }
    ctx.restore()
  }

  private _renderFigureDescription(
    ctx: CanvasRenderingContext2D,
    element: IElement,
    x: number,
    y: number,
    width: number,
    height: number
  ) {
    if (!element.imgFigureDescription) return
    const { scale, imgCaption } = this.options
    const fontSize = imgCaption.size * scale
    const fontFamily = imgCaption.font
    let topOffset = ImageParticle.FIGURE_DESCRIPTION_GAP * scale
    if (element.imgCaption?.value) {
      const captionFontSize =
        (element.imgCaption.size || imgCaption.size) * scale
      const captionTop = (element.imgCaption.top ?? imgCaption.top) * scale
      topOffset += captionTop + captionFontSize
    }
    ctx.save()
    ctx.font = `${fontSize}px ${fontFamily}`
    ctx.fillStyle = '#333333'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    let descText = element.imgFigureDescription
    const descMetrics = ctx.measureText(descText)
    if (descMetrics.width > width && width > 0) {
      let left = 0
      let right = descText.length
      while (left < right) {
        const mid = Math.ceil((left + right) / 2)
        const truncated = descText.substring(0, mid)
        if (ctx.measureText(truncated + '...').width <= width) {
          left = mid
        } else {
          right = mid - 1
        }
      }
      descText = descText.substring(0, left) + '...'
    }
    ctx.fillText(descText, x, y + height + topOffset)
    ctx.restore()
  }

  public render(
    ctx: CanvasRenderingContext2D,
    element: IElement,
    x: number,
    y: number
  ) {
    const { scale } = this.options
    const width = element.width! * scale
    const height = element.height! * scale
    if (this.imageCache.has(element.value)) {
      const img = this.imageCache.get(element.value)!
      this._drawImageWithCrop(ctx, img, element, x, y, width, height)
      this._renderCaption(ctx, element, x, y, width, height)
    } else {
      const cacheRenderCount = this.draw.getRenderCount()
      const imageLoadPromise = new Promise((resolve, reject) => {
        const img = new Image()
        img.setAttribute('crossOrigin', 'Anonymous')
        img.src = element.value
        img.onload = () => {
          this.imageCache.set(element.value, img)
          resolve(element)
          // 因图片加载异步，图片加载后可能属于上一次渲染方法
          if (cacheRenderCount !== this.draw.getRenderCount()) return
          // 衬于文字下方图片需要重新首先绘制
          if (element.imgDisplay === ImageDisplay.FLOAT_BOTTOM) {
            this.draw.render({
              isCompute: false,
              isSetCursor: false,
              isSubmitHistory: false
            })
          } else {
            this._drawImageWithCrop(ctx, img, element, x, y, width, height)
            this._renderCaption(ctx, element, x, y, width, height)
          }
        }
        img.onerror = error => {
          const fallbackImage = this.getFallbackImage(width, height)
          fallbackImage.onload = () => {
            this._drawImageWithCrop(
              ctx,
              fallbackImage,
              element,
              x,
              y,
              width,
              height
            )
            this.imageCache.set(element.value, fallbackImage)
            this._renderFigureLabel(ctx, element, x, y, width)
            this._renderCaption(ctx, element, x, y, width, height)
            this._renderFigureDescription(ctx, element, x, y, width, height)
          }
          reject(error)
        }
      })
      this.addImageObserver(imageLoadPromise)
    }
  }
}
