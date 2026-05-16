import { IFooter } from '../../interface/Footer'
import { MaxHeightRatio } from '../enum/Common'

export const defaultFooterOption: Readonly<Required<IFooter>> = {
  bottom: 30,
  inactiveAlpha: 0.6,
  maxHeightRadio: MaxHeightRatio.HALF,
  disabled: false,
  editable: true,
  firstPageEnabled: false,
  oddEvenEnabled: false
}
