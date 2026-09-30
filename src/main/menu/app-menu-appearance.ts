import type { KeybindingActionId } from '../../shared/keybindings'
import { translateMain } from '../i18n/main-i18n'

export type AppearanceMenuState = {
  showTasksButton: boolean
  showAutomationsButton: boolean
  showMobileButton: boolean
  showTitlebarAppName: boolean
  statusBarVisible: boolean
}

export type AppearanceMenuKey = keyof AppearanceMenuState

export function getNextDefaultOnAppearanceSettingValue(current: boolean | undefined): boolean {
  return !(current !== false)
}

export type BuildAppearanceSubmenuOptions = {
  appearance: AppearanceMenuState
  shortcutLabel: (actionId: KeybindingActionId) => string
  onToggleLeftSidebar: () => void
  onToggleRightSidebar: () => void
  onToggleAppearance: (key: AppearanceMenuKey) => void
}

// Why: mirror View > Appearance submenu so users can toggle sidebar/status-bar/buttons from the menu bar.
export function buildAppearanceSubmenu(
  options: BuildAppearanceSubmenuOptions
): Electron.MenuItemConstructorOptions {
  const {
    appearance,
    shortcutLabel,
    onToggleLeftSidebar,
    onToggleRightSidebar,
    onToggleAppearance
  } = options

  return {
    label: translateMain('menu.appearance', 'Appearance'),
    submenu: [
      {
        // Why: display-only shortcut hint — not a real accelerator to prevent stealing chords before editor carve-outs.
        label: `${translateMain('menu.toggleLeftSidebar', 'Toggle Left Sidebar')}\t${shortcutLabel('sidebar.left.toggle')}`,
        click: () => onToggleLeftSidebar()
      },
      {
        // Why: display-only shortcut hint for the same reason as above.
        label: `${translateMain('menu.toggleRightSidebar', 'Toggle Right Sidebar')}\t${shortcutLabel('sidebar.right.toggle')}`,
        click: () => onToggleRightSidebar()
      },
      {
        label: translateMain('menu.showStatusBar', 'Show Status Bar'),
        type: 'checkbox',
        checked: appearance.statusBarVisible,
        click: () => onToggleAppearance('statusBarVisible')
      },
      { type: 'separator' },
      {
        label: translateMain('menu.showTasksButton', 'Show Tasks Button'),
        type: 'checkbox',
        checked: appearance.showTasksButton,
        click: () => onToggleAppearance('showTasksButton')
      },
      {
        label: translateMain('menu.showAutomationsButton', 'Show Automations Button'),
        type: 'checkbox',
        checked: appearance.showAutomationsButton,
        click: () => onToggleAppearance('showAutomationsButton')
      },
      {
        label: translateMain('menu.showMobileButton', 'Show Orca Mobile Button'),
        type: 'checkbox',
        checked: appearance.showMobileButton,
        click: () => onToggleAppearance('showMobileButton')
      },
      {
        label: translateMain('menu.showTitlebarAppName', 'Show Titlebar App Name'),
        type: 'checkbox',
        checked: appearance.showTitlebarAppName,
        click: () => onToggleAppearance('showTitlebarAppName')
      }
    ]
  }
}
