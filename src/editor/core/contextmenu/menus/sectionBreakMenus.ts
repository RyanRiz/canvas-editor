import { INTERNAL_CONTEXT_MENU_KEY } from '../../../dataset/constant/ContextMenu'
import { SectionBreakType } from '../../../dataset/enum/SectionBreak'
import { IRegisterContextMenu } from '../../../interface/contextmenu/ContextMenu'
import { Command } from '../../command/Command'

const {
  SECTION_BREAK: { NEXT_PAGE, CONTINUOUS, EVEN_PAGE, ODD_PAGE }
} = INTERNAL_CONTEXT_MENU_KEY

export const sectionBreakMenus: IRegisterContextMenu[] = [
  {
    key: NEXT_PAGE,
    i18nPath: 'contextmenu.sectionBreak.nextPage',
    when: payload => {
      return !payload.isReadonly
    },
    callback: (command: Command) => {
      command.executeInsertSectionBreak(SectionBreakType.NEXT_PAGE)
    }
  },
  {
    key: CONTINUOUS,
    i18nPath: 'contextmenu.sectionBreak.continuous',
    when: payload => {
      return !payload.isReadonly
    },
    callback: (command: Command) => {
      command.executeInsertSectionBreak(SectionBreakType.CONTINUOUS)
    }
  },
  {
    key: EVEN_PAGE,
    i18nPath: 'contextmenu.sectionBreak.evenPage',
    when: payload => {
      return !payload.isReadonly
    },
    callback: (command: Command) => {
      command.executeInsertSectionBreak(SectionBreakType.EVEN_PAGE)
    }
  },
  {
    key: ODD_PAGE,
    i18nPath: 'contextmenu.sectionBreak.oddPage',
    when: payload => {
      return !payload.isReadonly
    },
    callback: (command: Command) => {
      command.executeInsertSectionBreak(SectionBreakType.ODD_PAGE)
    }
  }
]
