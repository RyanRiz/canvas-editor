import { IRulerOption, RulerUnit } from '../../interface/Ruler'

export const defaultRulerOption: Readonly<Required<IRulerOption>> = {
  disabled: true,
  unit: RulerUnit.IN,
  size: 22,
  marginColor: '#bcbcbc',
  contentColor: '#ffffff',
  tickColor: '#7a7a7a',
  labelColor: '#3a3a3a',
  labelFont: 'Arial',
  labelSize: 9,
  markerColor: '#5d5d5d',
  markerBorderColor: '#3a3a3a',
  defaultTabStopInterval: 48 // 0.5 inch at 96dpi
}
