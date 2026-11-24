import { describe, expect, it } from 'vitest';
import type { DosageInstruction, DosageInstructionInput } from '../types/dosage';
import {
  buildDosageLabel, buildDosageText, duplicateDosageText, formToDosageInput, formatDosageCode,
  groupDosageLines, hasDosages, maxDosageNumber, mergeDosageMaster, nextDosageCode, snapshotDosage,
  validateDosageForm, EMPTY_DOSAGE_FORM, type DosageFormValues,
} from './dosages';

function input(overrides: Partial<DosageInstructionInput> = {}): DosageInstructionInput {
  return {
    doseAmount: '1',
    doseUnit: 'tablet',
    route: 'oral',
    frequency: 'twice_daily',
    timing: 'after_food',
    durationDays: 5,
    ...overrides,
  };
}

function instruction(overrides: Partial<DosageInstruction> = {}): DosageInstruction {
  return {
    id: 'dos-1',
    code: 'DOS-000001',
    ...input(),
    isActive: true,
    ...overrides,
  };
}

function form(overrides: Partial<DosageFormValues> = {}): DosageFormValues {
  return { ...EMPTY_DOSAGE_FORM, ...overrides };
}

describe('buildDosageText', () => {
  it('writes plain bilingual directions, not sig abbreviations', () => {
    expect(buildDosageText(input())).toEqual({
      textEn: 'Take 1 tablet by mouth twice daily after food for 5 days.',
      textAr: 'تناول حبة واحدة عن طريق الفم مرتين يومياً بعد الطعام لمدة 5 أيام.',
    });
  });

  it('uses the dual and plural Arabic forms for more than one unit', () => {
    const two = buildDosageText(input({
      doseAmount: '2', frequency: 'once_daily', timing: 'none', durationDays: undefined,
    }));
    expect(two.textEn).toBe('Take 2 tablets by mouth once daily.');
    expect(two.textAr).toBe('تناول حبتين عن طريق الفم مرة واحدة يومياً.');
    expect(two.textEn).not.toContain('BID');
    expect(two.textEn).not.toContain('q.d.');
  });

  it('appends extra directions as their own sentences', () => {
    const text = buildDosageText(input({
      additionalInstructionsEn: 'Do not exceed 8 tablets in 24 hours',
      additionalInstructionsAr: 'لا تتجاوز 8 حبات في 24 ساعة',
    }));
    expect(text.textEn).toBe(
      'Take 1 tablet by mouth twice daily after food for 5 days. Do not exceed 8 tablets in 24 hours.'
    );
    expect(text.textAr).toBe(
      'تناول حبة واحدة عن طريق الفم مرتين يومياً بعد الطعام لمدة 5 أيام. لا تتجاوز 8 حبات في 24 ساعة.'
    );
  });

  it('uses the custom schedule in both languages', () => {
    const text = buildDosageText(input({
      frequency: 'custom',
      customFrequencyEn: 'on Monday, Wednesday and Friday',
      customFrequencyAr: 'يوم الاثنين والأربعاء والجمعة',
      timing: 'none',
      durationDays: undefined,
    }));
    expect(text.textEn).toBe('Take 1 tablet by mouth on Monday, Wednesday and Friday.');
    expect(text.textAr).toBe('تناول حبة واحدة عن طريق الفم يوم الاثنين والأربعاء والجمعة.');
  });

  it('keeps a non-integer measured dose readable', () => {
    const text = buildDosageText(input({
      doseAmount: '0.5', doseUnit: 'ml', route: 'oral', timing: 'none', durationDays: undefined,
    }));
    expect(text.textEn).toBe('Take 0.5 ml by mouth twice daily.');
  });
});

describe('compact label text', () => {
  it('prints the short schedule the owner asked for, with no duration or extra warnings', () => {
    const label = buildDosageLabel(input({
      durationDays: 5,
      additionalInstructionsEn: 'Do not exceed 8 tablets in 24 hours.',
      additionalInstructionsAr: 'لا تتجاوز 8 حبات في 24 ساعة.',
    }));
    expect(label).toEqual({
      labelEn: 'twice daily after meals',
      labelAr: 'حبة مرتين يومياً بعد الأكل',
    });
    expect(label.labelEn).not.toContain('for 5 days');
    expect(label.labelAr).not.toContain('لمدة');
  });

  it('names a two-unit dose in both languages', () => {
    const label = buildDosageLabel(input({
      doseAmount: '2', frequency: 'once_daily', timing: 'none', durationDays: undefined,
    }));
    expect(label.labelEn).toBe('2 tablets once daily');
    expect(label.labelAr).toBe('حبتين مرة واحدة يومياً');
  });

  it('keeps a measured liquid dose and a before-meal timing', () => {
    const label = buildDosageLabel(input({
      doseAmount: '5', doseUnit: 'ml', frequency: 'three_times_daily', timing: 'before_food',
    }));
    expect(label.labelEn).toBe('5 ml three times daily before meals');
    expect(label.labelAr).toBe('5 مل 3 مرات يومياً قبل الأكل');
  });

  it('supports a fractional dose and a custom schedule', () => {
    const label = buildDosageLabel(input({
      doseAmount: '0.5',
      doseUnit: 'ml',
      frequency: 'custom',
      customFrequencyEn: 'on Monday and Thursday',
      customFrequencyAr: 'يوم الاثنين والخميس',
      timing: 'none',
    }));
    expect(label.labelEn).toBe('0.5 ml on Monday and Thursday');
    expect(label.labelAr).toBe('0.5 مل يوم الاثنين والخميس');
  });
});

describe('numbering', () => {
  it('formats, finds the maximum and continues the sequence', () => {
    expect(formatDosageCode(12)).toBe('DOS-000012');
    const rows = [instruction({ code: 'DOS-000002' }), instruction({ id: 'dos-2', code: 'DOS-000010' })];
    expect(maxDosageNumber(rows)).toBe(10);
    expect(nextDosageCode(rows)).toBe('DOS-000011');
    expect(nextDosageCode([])).toBe('DOS-000001');
  });
});

describe('validation', () => {
  it('requires a dose and a description for a custom schedule', () => {
    const errors = validateDosageForm(form({ doseAmount: ' ', frequency: 'custom' }));
    expect(errors.doseAmount).toBeTruthy();
    expect(errors.customFrequencyEn).toBeTruthy();
    expect(errors.customFrequencyAr).toBeTruthy();
  });

  it('rejects an out-of-range course length but accepts a blank one', () => {
    expect(validateDosageForm(form({ durationDays: '0' })).durationDays).toBeTruthy();
    expect(validateDosageForm(form({ durationDays: '366' })).durationDays).toBeTruthy();
    expect(validateDosageForm(form({ durationDays: '366.5' })).durationDays).toBeTruthy();
    expect(validateDosageForm(form({ durationDays: '' })).durationDays).toBeUndefined();
  });

  it('drops custom text when the frequency is not custom', () => {
    const parsed = formToDosageInput(form({ customFrequencyEn: 'sometimes', customFrequencyAr: 'أحياناً' }));
    expect(parsed.customFrequencyEn).toBeUndefined();
    expect(parsed.customFrequencyAr).toBeUndefined();
  });
});

describe('duplicate detection', () => {
  it('finds a row that generates the same English directions, ignoring the row being edited', () => {
    const rows = [instruction()];
    expect(duplicateDosageText(rows, input())?.code).toBe('DOS-000001');
    expect(duplicateDosageText(rows, input(), 'dos-1')).toBeUndefined();
    expect(duplicateDosageText(rows, input({ durationDays: 3 }))).toBeUndefined();
  });
});

describe('sale snapshot', () => {
  it('freezes code and generated text and drops master-only fields', () => {
    const snap = snapshotDosage(instruction({ createdAt: '2026-01-01', updatedAt: '2026-01-02' }));
    expect(snap.dosageId).toBe('dos-1');
    expect(snap.code).toBe('DOS-000001');
    expect(snap.textEn).toBe('Take 1 tablet by mouth twice daily after food for 5 days.');
    expect(snap.textAr).toBe('تناول حبة واحدة عن طريق الفم مرتين يومياً بعد الطعام لمدة 5 أيام.');
    expect('isActive' in snap).toBe(false);
    expect('createdAt' in snap).toBe(false);
    expect('updatedAt' in snap).toBe(false);
    expect('id' in snap).toBe(false);
  });
});

describe('print grouping', () => {
  const snapA = snapshotDosage(instruction());
  const snapB = snapshotDosage(instruction({ id: 'dos-2', code: 'DOS-000002', durationDays: 3 }));

  it('merges batch-split lines but keeps contradictory directions apart', () => {
    const groups = groupDosageLines([
      { itemId: 'itm-1', itemNameAr: 'أ', itemNameEn: 'A', qty: 1, unit: 'Strip', dosage: snapA },
      { itemId: 'itm-1', itemNameAr: 'أ', itemNameEn: 'A', qty: 2, unit: 'Strip', dosage: snapA },
      { itemId: 'itm-1', itemNameAr: 'أ', itemNameEn: 'A', qty: 1, unit: 'Strip', dosage: snapB },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.dosage.code === 'DOS-000001')?.qty).toBe(3);
    expect(groups.find((g) => g.dosage.code === 'DOS-000002')?.qty).toBe(1);
  });

  it('ignores lines without directions and reports whether any exist', () => {
    const lines = [{ itemId: 'itm-1', itemNameAr: '', itemNameEn: 'A', qty: 1, dosage: undefined }];
    expect(groupDosageLines(lines)).toEqual([]);
    expect(hasDosages(lines)).toBe(false);
    expect(hasDosages([{ ...lines[0], dosage: snapA }])).toBe(true);
  });
});

describe('persist merge', () => {
  it('keeps edits, assigns missing codes and appends new seed rows', () => {
    const seeds = [
      instruction({ code: 'DOS-000001' }),
      instruction({ id: 'dos-2', code: 'DOS-000002' }),
    ];
    const persisted = [
      instruction({ code: 'DOS-000001', doseAmount: '2' }),
      { ...instruction({ id: 'dos-legacy', code: '' }), code: '' },
    ];
    const merged = mergeDosageMaster(persisted, seeds);
    expect(merged.find((d) => d.id === 'dos-1')?.doseAmount).toBe('2');
    expect(merged.find((d) => d.id === 'dos-legacy')?.code).toBe('DOS-000003');
    expect(merged.some((d) => d.id === 'dos-2')).toBe(true);
    expect(new Set(merged.map((d) => d.id)).size).toBe(merged.length);
  });
});
