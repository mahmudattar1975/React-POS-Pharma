// Invoice numbers are generated in the browser from per-terminal counters. When four pharmacies
// share one PharmaDB those counters would collide (two registers both issuing SIM-000001), so the
// terminal's branch code is prefixed. Older installations have no cached branch code yet, which
// deliberately keeps the original unprefixed format.
import { useSettingsStore } from '../store/settingsStore';

export function branchNumberPrefix(): string {
  const code = useSettingsStore.getState().settings.branchCode?.trim();
  return code ? `${code}-` : '';
}
