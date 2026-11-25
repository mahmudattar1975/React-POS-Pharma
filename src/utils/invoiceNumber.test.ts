import { describe, expect, it, afterEach } from 'vitest';
import { useSettingsStore } from '../store/settingsStore';
import { branchNumberPrefix } from './invoiceNumber';

describe('branch number prefix', () => {
  afterEach(() => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, branchCode: undefined } }));
  });

  it('keeps the historical format when the terminal has no branch code yet', () => {
    expect(branchNumberPrefix()).toBe('');
  });

  it('prefixes new document numbers with the terminal branch code', () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, branchCode: 'JED' } }));
    expect(branchNumberPrefix()).toBe('JED-');
  });
});
