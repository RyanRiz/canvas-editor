import { EditorMode, EditorZone } from '../../../../dataset/enum/Editor'
import { KeyMap } from '../../../../dataset/enum/KeyMap'
import { isApple } from '../../../../utils/ua'
import { isMod } from '../../../../utils/hotkey'
import { CanvasEvent } from '../../CanvasEvent'
import { backspace } from './backspace'
import { ctrlBackspace } from './ctrlBackspace'
import { ctrlEnter } from './ctrlEnter'
import { del } from './delete'
import { enter } from './enter'
import { indent } from './indent'
import { left } from './left'
import { right } from './right'
import { tab } from './tab'
import { updown } from './updown'
import { home } from './home'
import { end } from './end'

export function keydown(evt: KeyboardEvent, host: CanvasEvent) {
  if (host.isComposing) return
  const draw = host.getDraw()
  // 键盘事件逻辑分发
  if (isMod(evt) && evt.key === KeyMap.Backspace) {
    ctrlBackspace(evt, host)
  } else if (evt.key === KeyMap.Backspace) {
    backspace(evt, host)
  } else if (evt.key === KeyMap.Delete) {
    del(evt, host)
  } else if (isMod(evt) && evt.key === KeyMap.Enter) {
    ctrlEnter(evt, host)
  } else if (evt.key === KeyMap.Enter) {
    enter(evt, host)
  } else if (evt.key === KeyMap.Left) {
    // Mac: Cmd+Left = Home
    if (isApple && evt.metaKey) {
      home(evt, host)
    } else {
      left(evt, host)
    }
  } else if (evt.key === KeyMap.Right) {
    // Mac: Cmd+Right = End
    if (isApple && evt.metaKey) {
      end(evt, host)
    } else {
      right(evt, host)
    }
  } else if (evt.key === KeyMap.Up || evt.key === KeyMap.Down) {
    updown(evt, host)
  } else if (evt.key === KeyMap.Home) {
    home(evt, host)
  } else if (evt.key === KeyMap.End) {
    end(evt, host)
  } else if (isMod(evt) && evt.key.toLocaleLowerCase() === KeyMap.Z) {
    if (draw.isReadonly() && draw.getMode() !== EditorMode.FORM) return
    draw.getHistoryManager().undo()
    evt.preventDefault()
  } else if (isMod(evt) && evt.key.toLocaleLowerCase() === KeyMap.Y) {
    if (draw.isReadonly() && draw.getMode() !== EditorMode.FORM) return
    draw.getHistoryManager().redo()
    evt.preventDefault()
  } else if (isMod(evt) && evt.key.toLocaleLowerCase() === KeyMap.C) {
    host.copy()
    evt.preventDefault()
  } else if (isMod(evt) && evt.key.toLocaleLowerCase() === KeyMap.X) {
    host.cut()
    evt.preventDefault()
  } else if (isMod(evt) && evt.key.toLocaleLowerCase() === KeyMap.A) {
    host.selectAll()
    evt.preventDefault()
  } else if (isMod(evt) && evt.key.toLocaleLowerCase() === KeyMap.M) {
    if (draw.isReadonly()) return
    indent(evt, host)
  } else if (isMod(evt) && evt.key.toLocaleLowerCase() === KeyMap.T) {
    if (draw.isReadonly()) return
    indent(evt, host)
  } else if (isMod(evt) && evt.key.toLocaleLowerCase() === KeyMap.S) {
    if (draw.isReadonly()) return
    const listener = draw.getListener()
    if (listener.saved) {
      listener.saved(draw.getValue())
    }
    const eventBus = draw.getEventBus()
    if (eventBus.isSubscribe('saved')) {
      eventBus.emit('saved', draw.getValue())
    }
    evt.preventDefault()
  } else if (isMod(evt) && evt.key.toLocaleLowerCase() === KeyMap.V && evt.shiftKey) {
    // Ctrl+Shift+V: paste as plain text. Firefox includes text/html in
    // the paste event even for plain-text paste, so the normal paste
    // handler takes the HTML path and produces nothing. Intercept here
    // and read directly from the clipboard as plain text.
    // Also reset style attributes so the text uses defaults (black color,
    // no bold/italic/underline) — matching what users expect from
    // "paste without formatting".
    if (draw.isReadonly() || draw.isDisabled()) return
    evt.preventDefault()
    navigator.clipboard.readText().then((text) => {
      if (!text) return
      const rangeManager = draw.getRange()
      const prevDefaultStyle = rangeManager.getDefaultStyle()
      // Clear existing default style, then set neutral overrides so the
      // pasted text doesn't inherit color / bold / italic etc. from the
      // element under the cursor.
      rangeManager.setDefaultStyle(null)
      rangeManager.setDefaultStyle({
        bold: false,
        color: '#000000',
        italic: false,
        underline: false,
        strikeout: false
      })
      host.input(text)
      rangeManager.setDefaultStyle(prevDefaultStyle)
    }).catch(() => { /* clipboard read failed — silently ignored */ })
  } else if (isMod(evt) && evt.key.toLocaleLowerCase() === KeyMap.V) {
    // Ctrl+V (without Shift): let the native paste event on the hidden
    // textarea handle it. Only preventDefault if read-only.
    if (draw.isReadonly() || draw.isDisabled()) {
      evt.preventDefault()
    }
  } else if (evt.key === KeyMap.ESC) {
    // 退出格式刷
    host.clearPainterStyle()
    // 退出页眉页脚编辑
    const zoneManager = draw.getZone()
    if (!zoneManager.isMainActive()) {
      zoneManager.setZone(EditorZone.MAIN)
    }
    evt.preventDefault()
  } else if (evt.key === KeyMap.TAB) {
    tab(evt, host)
  }
}
