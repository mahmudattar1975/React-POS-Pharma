import { describe, expect, it } from 'vitest';
import { alertToneFromClass } from './alertSound';

// The cue follows the Alert severity, so a success message must never buzz like a failure. The
// mapping is read from MUI's generated class because every alert in the app is a plain <Alert>.
describe('alert sounds', () => {
  it('maps the three MUI alert variants to their severity tone', () => {
    expect(alertToneFromClass('MuiAlert-root MuiAlert-standardSuccess')).toBe('success');
    expect(alertToneFromClass('MuiAlert-root MuiAlert-filledError')).toBe('error');
    expect(alertToneFromClass('MuiAlert-root MuiAlert-outlinedWarning')).toBe('warning');
    expect(alertToneFromClass('MuiAlert-root MuiAlert-standardInfo')).toBe('info');
  });

  it('ignores elements that are not MUI alerts', () => {
    expect(alertToneFromClass('MuiTypography-root MuiTypography-body2')).toBeNull();
    expect(alertToneFromClass('')).toBeNull();
  });
});
