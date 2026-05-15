import { ICheckboxOption } from '../../interface/Checkbox'
import { VerticalAlign } from '../enum/VerticalAlign'

export const defaultCheckboxOption: Readonly<Required<ICheckboxOption>> = {
  width: 16,
  height: 16,
  gap: 7,
  lineWidth: 1.5,
  fillStyle: '#ffffff',
  strokeStyle: '#5F6368',
  checkFillStyle: '#1A73E8',
  checkStrokeStyle: '#1A73E8',
  checkMarkColor: '#ffffff',
  verticalAlign: VerticalAlign.BOTTOM
}
