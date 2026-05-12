export enum ListType {
  UL = 'ul',
  OL = 'ol'
}

export enum UlStyle {
  DISC = 'disc', // 实心圆点
  CIRCLE = 'circle', // 空心圆点
  SQUARE = 'square', // 实心方块
  CHECKBOX = 'checkbox' // 复选框
}

export enum OlStyle {
  DECIMAL = 'decimal', // 1. 2. 3.
  LOWER_ALPHA = 'lowerAlpha', // a. b. c.
  UPPER_ALPHA = 'upperAlpha', // A. B. C.
  LOWER_ROMAN = 'lowerRoman', // i. ii. iii.
  UPPER_ROMAN = 'upperRoman', // I. II. III.
  LEGAL = 'legal' // 1. 1.1. 1.1.1.
}

export enum ListStyle {
  DISC = UlStyle.DISC,
  CIRCLE = UlStyle.CIRCLE,
  SQUARE = UlStyle.SQUARE,
  CHECKBOX = UlStyle.CHECKBOX,
  DECIMAL = OlStyle.DECIMAL,
  LOWER_ALPHA = OlStyle.LOWER_ALPHA,
  UPPER_ALPHA = OlStyle.UPPER_ALPHA,
  LOWER_ROMAN = OlStyle.LOWER_ROMAN,
  UPPER_ROMAN = OlStyle.UPPER_ROMAN,
  LEGAL = OlStyle.LEGAL
}
