import type { PluginSources } from '../../relay/plugin-overlay'
import { isTuiAgentEnabled } from '../../shared/tui-agent-selection'
import { isAgentStatusHooksEnabled } from './managed-agent-hook-controls'
import type { ManagedHookDetectionSettings } from './managed-hook-detection-commands'

export function isOpenCodeStatusPluginEnabled(
  settings: ManagedHookDetectionSettings,
  agent: 'opencode' | 'opencode2'
): boolean {
  return (
    isAgentStatusHooksEnabled(settings) && isTuiAgentEnabled(agent, settings?.disabledTuiAgents)
  )
}

export function openCodePluginSettingsKey(settings: ManagedHookDetectionSettings): string {
  return `${isOpenCodeStatusPluginEnabled(settings, 'opencode')}:${isOpenCodeStatusPluginEnabled(settings, 'opencode2')}`
}

export function selectOpenCodePluginSources(
  sources: PluginSources,
  settings: ManagedHookDetectionSettings
): PluginSources {
  // Older relays retain omitted sources; an empty string replaces the cache and cannot write a plugin.
  return {
    ...sources,
    opencodePluginSource: isOpenCodeStatusPluginEnabled(settings, 'opencode')
      ? sources.opencodePluginSource
      : '',
    opencode2PluginSource: isOpenCodeStatusPluginEnabled(settings, 'opencode2')
      ? sources.opencode2PluginSource
      : ''
  }
}
