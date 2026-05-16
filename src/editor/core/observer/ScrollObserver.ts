import { IEditorOption } from '../../interface/Editor'
import { debounce } from '../../utils'
import { Draw } from '../draw/Draw'

export interface IElementVisibleInfo {
  intersectionHeight: number
}

export interface IPageVisibleInfo {
  intersectionPageNo: number
  visiblePageNoList: number[]
}

export class ScrollObserver {
  private draw: Draw
  private options: Required<IEditorOption>
  private scrollContainer: Element | Document

  constructor(draw: Draw) {
    this.draw = draw
    this.options = draw.getOptions()
    this.scrollContainer = this.getScrollContainer()
    // 初次填充 visiblePageNoList——必须在 Editor 构造完成（pages 已挂载）之后
    // 触发，所以用 setTimeout 推迟到下一个 macrotask。原实现上还套着
    // `if (!window.scrollY)` 守卫——当宿主页面本身（document）已经滚动时
    // 跳过初次填充，导致 visiblePageNoList 永远是空数组。继而
    // `_buildPagePaintPlan` 返回 null，render() 回落到 `_immediateRender(null)`
    // 全页同步绘制（35 页文档上每次 render 800-1400ms 仅 paint 阶段）。
    // 这个守卫对非 document 的 scrollContainer 完全没有意义——它检查的是
    // window 滚动而非容器滚动，与本编辑器无关。无条件触发一次即可，
    // 内部的 debounce(_observer, 150) 自然消化后续滚动事件。
    setTimeout(() => {
      this._observer()
    })
    this._addEvent()
  }

  public getScrollContainer(): Element | Document {
    return this.options.scrollContainerSelector
      ? document.querySelector(this.options.scrollContainerSelector) || document
      : document
  }

  private _addEvent() {
    this.scrollContainer.addEventListener('scroll', this._observer)
  }

  public removeEvent() {
    this.scrollContainer.removeEventListener('scroll', this._observer)
  }

  public getElementVisibleInfo(element: Element): IElementVisibleInfo {
    const rect = element.getBoundingClientRect()
    const viewHeight =
      this.scrollContainer === document
        ? Math.max(document.documentElement.clientHeight, window.innerHeight)
        : (<Element>this.scrollContainer).clientHeight
    const visibleHeight =
      Math.min(rect.bottom, viewHeight) - Math.max(rect.top, 0)
    return {
      intersectionHeight: visibleHeight > 0 ? visibleHeight : 0
    }
  }

  public getPageVisibleInfo(): IPageVisibleInfo {
    const pageList = this.draw.getPageList()
    const visiblePageNoList: number[] = []
    let intersectionPageNo = 0
    let intersectionMaxHeight = 0
    for (let i = 0; i < pageList.length; i++) {
      const curPage = pageList[i]
      const { intersectionHeight } = this.getElementVisibleInfo(curPage)
      // 之前页存在交叉 && 当前页不交叉则后续均不交叉，结束循环
      if (intersectionMaxHeight && !intersectionHeight) break
      if (intersectionHeight) {
        visiblePageNoList.push(i)
      }
      if (intersectionHeight > intersectionMaxHeight) {
        intersectionMaxHeight = intersectionHeight
        intersectionPageNo = i
      }
    }
    return {
      intersectionPageNo,
      visiblePageNoList
    }
  }

  private _observer = debounce(() => {
    const { intersectionPageNo, visiblePageNoList } = this.getPageVisibleInfo()
    this.draw.setIntersectionPageNo(intersectionPageNo)
    this.draw.setVisiblePageNoList(visiblePageNoList)
  }, 150)
}
