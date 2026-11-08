// Pure helpers for the dosage-instruction (DOS/SIG) master and its printed sheet.
//
// The generator deliberately writes plain language in both languages instead of sig codes: BNF,
// the Joint Commission and ISMP all warn that abbreviations such as q.d./q.o.d./U are misread and
// reach patients as the wrong dose. "1 tablet twice daily after food" is longer, but it is what
// the patient can actually follow, and it is what the Arabic line says too.
import type {
  DosageDoseUnit,
  DosageFrequency,
  DosageInstruction,
  DosageInstructionInput,
  DosageRoute,
  DosageSnapshot,
  DosageTiming,
} from '../types/dosage';

export const DOSAGE_ROUTE_OPTIONS: {
  value: DosageRoute;
  labelEn: string;
  labelAr: string;
}[] = [
  { value: 'oral', labelEn: 'By mouth (oral)', labelAr: 'عن طريق الفم' },
  { value: 'topical', labelEn: 'On the skin (topical)', labelAr: 'على الجلد' },
  { value: 'ophthalmic', labelEn: 'Eye (ophthalmic)', labelAr: 'في العين' },
  { value: 'otic', labelEn: 'Ear (otic)', labelAr: 'في الأذن' },
  { value: 'nasal', labelEn: 'Nose (nasal)', labelAr: 'في الأنف' },
  { value: 'inhalation', labelEn: 'Inhalation', labelAr: 'بالاستنشاق' },
  { value: 'rectal', labelEn: 'Rectal', labelAr: 'شرجي' },
  { value: 'vaginal', labelEn: 'Vaginal', labelAr: 'مهبلي' },
  { value: 'sublingual', labelEn: 'Under the tongue (sublingual)', labelAr: 'تحت اللسان' },
  { value: 'injection', labelEn: 'Injection', labelAr: 'بالحقن' },
  { value: 'other', labelEn: 'Other / as directed', labelAr: 'أخرى / حسب التوجيه' },
];

export const DOSAGE_FREQUENCY_OPTIONS: {
  value: DosageFrequency;
  labelEn: string;
  labelAr: string;
  phraseEn: string;
  phraseAr: string;
}[] = [
  { value: 'once_daily', labelEn: 'Once daily', labelAr: 'مرة واحدة يومياً', phraseEn: 'once daily', phraseAr: 'مرة واحدة يومياً' },
  { value: 'twice_daily', labelEn: 'Twice daily', labelAr: 'مرتين يومياً', phraseEn: 'twice daily', phraseAr: 'مرتين يومياً' },
  { value: 'three_times_daily', labelEn: 'Three times daily', labelAr: '3 مرات يومياً', phraseEn: 'three times daily', phraseAr: '3 مرات يومياً' },
  { value: 'four_times_daily', labelEn: 'Four times daily', labelAr: '4 مرات يومياً', phraseEn: 'four times daily', phraseAr: '4 مرات يومياً' },
  { value: 'every_4_hours', labelEn: 'Every 4 hours', labelAr: 'كل 4 ساعات', phraseEn: 'every 4 hours', phraseAr: 'كل 4 ساعات' },
  { value: 'every_6_hours', labelEn: 'Every 6 hours', labelAr: 'كل 6 ساعات', phraseEn: 'every 6 hours', phraseAr: 'كل 6 ساعات' },
  { value: 'every_8_hours', labelEn: 'Every 8 hours', labelAr: 'كل 8 ساعات', phraseEn: 'every 8 hours', phraseAr: 'كل 8 ساعات' },
  { value: 'every_12_hours', labelEn: 'Every 12 hours', labelAr: 'كل 12 ساعة', phraseEn: 'every 12 hours', phraseAr: 'كل 12 ساعة' },
  { value: 'every_other_day', labelEn: 'Every other day', labelAr: 'يوماً بعد يوم', phraseEn: 'every other day', phraseAr: 'يوماً بعد يوم' },
  { value: 'once_weekly', labelEn: 'Once weekly', labelAr: 'مرة واحدة أسبوعياً', phraseEn: 'once weekly', phraseAr: 'مرة واحدة أسبوعياً' },
  { value: 'as_needed', labelEn: 'As needed (PRN)', labelAr: 'عند الحاجة', phraseEn: 'as needed', phraseAr: 'عند الحاجة' },
  { value: 'custom', labelEn: 'Custom schedule', labelAr: 'جدول مخصص', phraseEn: '', phraseAr: '' },
];

export const DOSAGE_TIMING_OPTIONS: {
  value: DosageTiming;
  labelEn: string;
  labelAr: string;
  phraseEn: string;
  phraseAr: string;
}[] = [
  { value: 'none', labelEn: 'No specific time', labelAr: 'بدون وقت محدد', phraseEn: '', phraseAr: '' },
  { value: 'before_food', labelEn: 'Before food', labelAr: 'قبل الطعام', phraseEn: 'before food', phraseAr: 'قبل الطعام' },
  { value: 'with_food', labelEn: 'With food', labelAr: 'مع الطعام', phraseEn: 'with food', phraseAr: 'مع الطعام' },
  { value: 'after_food', labelEn: 'After food', labelAr: 'بعد الطعام', phraseEn: 'after food', phraseAr: 'بعد الطعام' },
  { value: 'empty_stomach', labelEn: 'On an empty stomach', labelAr: 'على معدة فارغة', phraseEn: 'on an empty stomach', phraseAr: 'على معدة فارغة' },
  { value: 'morning', labelEn: 'In the morning', labelAr: 'في الصباح', phraseEn: 'in the morning', phraseAr: 'في الصباح' },
  { value: 'evening', labelEn: 'In the evening', labelAr: 'في المساء', phraseEn: 'in the evening', phraseAr: 'في المساء' },
  { value: 'bedtime', labelEn: 'At bedtime', labelAr: 'عند النوم', phraseEn: 'at bedtime', phraseAr: 'عند النوم' },
];

interface DoseUnitDefinition {
  value: DosageDoseUnit;
  labelEn: string;
  labelAr: string;
  enOne: string;
  enMany: string;
  arOne: string;
  arTwo: string;
  arFew: string;
  arMany: string;
  arUnit: string;
}

export const DOSAGE_DOSE_UNIT_OPTIONS: DoseUnitDefinition[] = [
  { value: 'tablet', labelEn: 'Tablet', labelAr: 'حبة', enOne: 'tablet', enMany: 'tablets', arOne: 'حبة واحدة', arTwo: 'حبتين', arFew: 'حبات', arMany: 'حبة', arUnit: 'حبة' },
  { value: 'capsule', labelEn: 'Capsule', labelAr: 'كبسولة', enOne: 'capsule', enMany: 'capsules', arOne: 'كبسولة واحدة', arTwo: 'كبسولتين', arFew: 'كبسولات', arMany: 'كبسولة', arUnit: 'كبسولة' },
  { value: 'ml', labelEn: 'ml', labelAr: 'مل', enOne: 'ml', enMany: 'ml', arOne: 'مل', arTwo: 'مل', arFew: 'مل', arMany: 'مل', arUnit: 'مل' },
  { value: 'drop', labelEn: 'Drop', labelAr: 'قطرة', enOne: 'drop', enMany: 'drops', arOne: 'قطرة واحدة', arTwo: 'قطرتين', arFew: 'قطرات', arMany: 'قطرة', arUnit: 'قطرة' },
  { value: 'puff', labelEn: 'Puff', labelAr: 'بخة', enOne: 'puff', enMany: 'puffs', arOne: 'بخة واحدة', arTwo: 'بختين', arFew: 'بخات', arMany: 'بخة', arUnit: 'بخة' },
  { value: 'spray', labelEn: 'Spray', labelAr: 'رشة', enOne: 'spray', enMany: 'sprays', arOne: 'رشة واحدة', arTwo: 'رشتين', arFew: 'رشات', arMany: 'رشة', arUnit: 'رشة' },
  { value: 'application', labelEn: 'Application', labelAr: 'دهنة', enOne: 'application', enMany: 'applications', arOne: 'دهنة واحدة', arTwo: 'دهنتين', arFew: 'دهنات', arMany: 'دهنة', arUnit: 'دهنة' },
  { value: 'sachet', labelEn: 'Sachet', labelAr: 'كيس', enOne: 'sachet', enMany: 'sachets', arOne: 'كيس واحد', arTwo: 'كيسين', arFew: 'أكياس', arMany: 'كيس', arUnit: 'كيس' },
  { value: 'suppository', labelEn: 'Suppository', labelAr: 'لبوسة', enOne: 'suppository', enMany: 'suppositories', arOne: 'لبوسة واحدة', arTwo: 'لبوسين', arFew: 'لبوسات', arMany: 'لبوسة', arUnit: 'لبوسة' },
  { value: 'patch', labelEn: 'Patch', labelAr: 'لاصقة', enOne: 'patch', enMany: 'patches', arOne: 'لاصقة واحدة', arTwo: 'لاصقتين', arFew: 'لاصقات', arMany: 'لاصقة', arUnit: 'لاصقة' },
  { value: 'vial', labelEn: 'Vial / ampoule', labelAr: 'أمبولة', enOne: 'vial', enMany: 'vials', arOne: 'أمبولة واحدة', arTwo: 'أمبولتين', arFew: 'أمبولات', arMany: 'أمبولة', arUnit: 'أمبولة' },
  { value: 'unit', labelEn: 'Unit / dose', labelAr: 'وحدة', enOne: 'unit', enMany: 'units', arOne: 'وحدة واحدة', arTwo: 'وحدتين', arFew: 'وحدات', arMany: 'وحدة', arUnit: 'وحدة' },
];

function unitDefinition(unit: DosageDoseUnit): DoseUnitDefinition {
  return DOSAGE_DOSE_UNIT_OPTIONS.find((u) => u.value === unit) ?? DOSAGE_DOSE_UNIT_OPTIONS[0];
}

function frequencyDefinition(frequency: DosageFrequency) {
  return DOSAGE_FREQUENCY_OPTIONS.find((f) => f.value === frequency) ?? DOSAGE_FREQUENCY_OPTIONS[0];
}

function timingDefinition(timing: DosageTiming) {
  return DOSAGE_TIMING_OPTIONS.find((t) => t.value === timing) ?? DOSAGE_TIMING_OPTIONS[0];
}

function numericAmount(amount: string): number | undefined {
  const n = Number(amount.trim());
  return Number.isFinite(n) ? n : undefined;
}

function isWhole(n: number | undefined): n is number {
  return n !== undefined && Number.isInteger(n);
}

function englishDose(amount: string, unit: DosageDoseUnit): string {
  const def = unitDefinition(unit);
  const n = numericAmount(amount);
  return `${amount.trim()} ${n === 1 ? def.enOne : def.enMany}`;
}

// Arabic number agreement: 1 and 2 have their own forms, 3–10 take the plural, 11+ the singular
// accusative. A non-integer (0.5, 1.5) falls back to "amount + singular noun", which reads correctly
// as a measured quantity ("0.5 حبة").
function arabicDose(amount: string, unit: DosageDoseUnit): string {
  const def = unitDefinition(unit);
  const n = numericAmount(amount);
  if (isWhole(n)) {
    if (n === 1) return def.arOne;
    if (n === 2) return def.arTwo;
    if (n >= 3 && n <= 10) return `${n} ${def.arFew}`;
    if (n > 10) return `${n} ${def.arMany}`;
  }
  return `${amount.trim()} ${def.arUnit}`;
}

function englishVerbAndPlace(route: DosageRoute, unit: DosageDoseUnit): { verb: string; place: string } {
  switch (route) {
    case 'oral':
      return { verb: 'Take', place: 'by mouth' };
    case 'topical':
      return { verb: 'Apply', place: 'to the affected area' };
    case 'ophthalmic':
      return { verb: unit === 'drop' || unit === 'ml' ? 'Instill' : 'Apply', place: 'into the affected eye(s)' };
    case 'otic':
      return { verb: unit === 'drop' || unit === 'ml' ? 'Instill' : 'Apply', place: 'into the affected ear(s)' };
    case 'nasal':
      return { verb: 'Use', place: 'into each nostril' };
    case 'inhalation':
      return { verb: 'Inhale', place: '' };
    case 'rectal':
      return { verb: 'Insert', place: 'rectally' };
    case 'vaginal':
      return { verb: 'Insert', place: 'vaginally' };
    case 'sublingual':
      return { verb: 'Place', place: 'under the tongue' };
    case 'injection':
      return { verb: 'Inject', place: '' };
    default:
      return { verb: 'Use', place: 'as directed' };
  }
}

function arabicVerbAndPlace(route: DosageRoute, unit: DosageDoseUnit): { verb: string; place: string } {
  switch (route) {
    case 'oral':
      return { verb: 'تناول', place: 'عن طريق الفم' };
    case 'topical':
      return { verb: 'ضع', place: 'على المنطقة المصابة' };
    case 'ophthalmic':
      return { verb: unit === 'drop' || unit === 'ml' ? 'قطّر' : 'ضع', place: 'في العين المصابة' };
    case 'otic':
      return { verb: unit === 'drop' || unit === 'ml' ? 'قطّر' : 'ضع', place: 'في الأذن المصابة' };
    case 'nasal':
      return { verb: 'استخدم', place: 'في الأنف' };
    case 'inhalation':
      return { verb: 'استنشق', place: '' };
    case 'rectal':
      return { verb: 'أدخل', place: 'شرجياً' };
    case 'vaginal':
      return { verb: 'أدخل', place: 'مهبلياً' };
    case 'sublingual':
      return { verb: 'ضع', place: 'تحت اللسان' };
    case 'injection':
      return { verb: 'احقن', place: 'عن طريق الحقن' };
    default:
      return { verb: 'استخدم', place: 'حسب التوجيه' };
  }
}

function englishDuration(days: number | undefined): string {
  if (!days || days < 1) return '';
  return days === 1 ? 'for 1 day' : `for ${days} days`;
}

function arabicDuration(days: number | undefined): string {
  if (!days || days < 1) return '';
  if (days === 1) return 'لمدة يوم واحد';
  if (days === 2) return 'لمدة يومين';
  if (days <= 10) return `لمدة ${days} أيام`;
  return `لمدة ${days} يوماً`;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return /[.!?؟]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

// Generates the plain-language English and Arabic instruction from the structured fields. Kept as
// one function so the preview, the saved master and the sale snapshot can never disagree.
export function buildDosageText(input: DosageInstructionInput): { textEn: string; textAr: string } {
  const frequency = frequencyDefinition(input.frequency);
  const timing = timingDefinition(input.timing);
  const freqEn = input.frequency === 'custom' ? (input.customFrequencyEn ?? '').trim() : frequency.phraseEn;
  const freqAr = input.frequency === 'custom' ? (input.customFrequencyAr ?? '').trim() : frequency.phraseAr;

  const en = englishVerbAndPlace(input.route, input.doseUnit);
  const ar = arabicVerbAndPlace(input.route, input.doseUnit);

  const enParts = [
    en.verb,
    englishDose(input.doseAmount || '1', input.doseUnit),
    en.place,
    freqEn,
    timing.phraseEn,
    englishDuration(input.durationDays),
  ];
  const arParts = [
    ar.verb,
    arabicDose(input.doseAmount || '1', input.doseUnit),
    ar.place,
    freqAr,
    timing.phraseAr,
    arabicDuration(input.durationDays),
  ];

  const textEn = [sentence(enParts.filter(Boolean).join(' ')), sentence(input.additionalInstructionsEn ?? '')]
    .filter(Boolean)
    .join(' ');
  const textAr = [sentence(arParts.filter(Boolean).join(' ')), sentence(input.additionalInstructionsAr ?? '')]
    .filter(Boolean)
    .join(' ');

  return { textEn, textAr };
}

// ---- Compact label form ------------------------------------------------------------------------
// The small direction label is not the full instruction sentence. On a 50mm label the patient sees
// the item name and the shortest unambiguous schedule:
//     حبة مرتين يومياً بعد الأكل
//     twice daily after meals
// Verb, route, course length and extra warnings stay in the master/POS preview and on the detailed
// directions screen; repeating them here would make the text unreadably small. The dose is always
// spoken in Arabic ("حبة" / "حبتين") and is added to English only when it is not one unit, so a
// two-tablet dose can never read as a one-tablet dose.
const LABEL_TIMING: Record<DosageTiming, { en: string; ar: string }> = {
  none: { en: '', ar: '' },
  before_food: { en: 'before meals', ar: 'قبل الأكل' },
  with_food: { en: 'with meals', ar: 'مع الأكل' },
  after_food: { en: 'after meals', ar: 'بعد الأكل' },
  empty_stomach: { en: 'on an empty stomach', ar: 'على معدة فارغة' },
  morning: { en: 'in the morning', ar: 'في الصباح' },
  evening: { en: 'in the evening', ar: 'في المساء' },
  bedtime: { en: 'at bedtime', ar: 'عند النوم' },
};

function arabicLabelDose(amount: string, unit: DosageDoseUnit): string {
  const def = unitDefinition(unit);
  const n = numericAmount(amount);
  if (isWhole(n)) {
    if (n === 1) return def.arUnit; // "حبة", not the full "حبة واحدة"
    if (n === 2) return def.arTwo;
    if (n >= 3 && n <= 10) return `${n} ${def.arFew}`;
    if (n > 10) return `${n} ${def.arMany}`;
  }
  return `${amount.trim()} ${def.arUnit}`;
}

function englishLabelDose(amount: string, unit: DosageDoseUnit): string {
  // One unit is the normal case and adds nothing on a tiny label; anything else must be spoken.
  return numericAmount(amount) === 1 ? '' : englishDose(amount, unit);
}

export function buildDosageLabel(input: DosageInstructionInput): { labelEn: string; labelAr: string } {
  const frequency = frequencyDefinition(input.frequency);
  const freqEn = input.frequency === 'custom' ? (input.customFrequencyEn ?? '').trim() : frequency.phraseEn;
  const freqAr = input.frequency === 'custom' ? (input.customFrequencyAr ?? '').trim() : frequency.phraseAr;
  const timing = LABEL_TIMING[input.timing] ?? LABEL_TIMING.none;
  const amount = input.doseAmount || '1';

  return {
    labelEn: [englishLabelDose(amount, input.doseUnit), freqEn, timing.en].filter(Boolean).join(' '),
    labelAr: [arabicLabelDose(amount, input.doseUnit), freqAr, timing.ar].filter(Boolean).join(' '),
  };
}

// ---- Numbering ---------------------------------------------------------------------------------
// Codes are system-assigned and gap-free, like the vendor/company masters: the owner never types
// them, and a deleted DOS can never cause a duplicate on the next save.
export const DOSAGE_CODE_PREFIX = 'DOS-';

export function formatDosageCode(n: number): string {
  return `${DOSAGE_CODE_PREFIX}${String(n).padStart(6, '0')}`;
}

export function maxDosageNumber(dosages: Pick<DosageInstruction, 'code'>[]): number {
  let max = 0;
  for (const dosage of dosages) {
    const match = /(\d+)\s*$/.exec(dosage.code ?? '');
    const n = match ? Number(match[1]) : 0;
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}

export function nextDosageCode(dosages: Pick<DosageInstruction, 'code'>[]): string {
  return formatDosageCode(maxDosageNumber(dosages) + 1);
}

// ---- Form model --------------------------------------------------------------------------------
export interface DosageFormValues {
  doseAmount: string;
  doseUnit: DosageDoseUnit;
  route: DosageRoute;
  frequency: DosageFrequency;
  customFrequencyAr: string;
  customFrequencyEn: string;
  timing: DosageTiming;
  durationDays: string;
  additionalInstructionsAr: string;
  additionalInstructionsEn: string;
  isActive: boolean;
}

export const EMPTY_DOSAGE_FORM: DosageFormValues = {
  doseAmount: '1',
  doseUnit: 'tablet',
  route: 'oral',
  frequency: 'twice_daily',
  customFrequencyAr: '',
  customFrequencyEn: '',
  timing: 'after_food',
  durationDays: '',
  additionalInstructionsAr: '',
  additionalInstructionsEn: '',
  isActive: true,
};

export function dosageToForm(dosage: DosageInstruction): DosageFormValues {
  return {
    doseAmount: dosage.doseAmount,
    doseUnit: dosage.doseUnit,
    route: dosage.route,
    frequency: dosage.frequency,
    customFrequencyAr: dosage.customFrequencyAr ?? '',
    customFrequencyEn: dosage.customFrequencyEn ?? '',
    timing: dosage.timing,
    durationDays: dosage.durationDays === undefined ? '' : String(dosage.durationDays),
    additionalInstructionsAr: dosage.additionalInstructionsAr ?? '',
    additionalInstructionsEn: dosage.additionalInstructionsEn ?? '',
    isActive: dosage.isActive !== false,
  };
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function formToDosageInput(values: DosageFormValues): DosageInstructionInput {
  return {
    doseAmount: values.doseAmount.trim(),
    doseUnit: values.doseUnit,
    route: values.route,
    frequency: values.frequency,
    customFrequencyAr:
      values.frequency === 'custom' ? optionalText(values.customFrequencyAr) : undefined,
    customFrequencyEn:
      values.frequency === 'custom' ? optionalText(values.customFrequencyEn) : undefined,
    timing: values.timing,
    durationDays: values.durationDays.trim() === '' ? undefined : Number(values.durationDays),
    additionalInstructionsAr: optionalText(values.additionalInstructionsAr),
    additionalInstructionsEn: optionalText(values.additionalInstructionsEn),
  };
}

export type DosageFormErrors = Partial<Record<keyof DosageFormValues, string>>;

export function validateDosageForm(values: DosageFormValues): DosageFormErrors {
  const errors: DosageFormErrors = {};

  if (!values.doseAmount.trim()) errors.doseAmount = 'Enter the amount for one dose.';
  else if (values.doseAmount.trim().length > 20) errors.doseAmount = 'Keep the dose amount short (max 20).';

  if (!DOSAGE_DOSE_UNIT_OPTIONS.some((u) => u.value === values.doseUnit)) {
    errors.doseUnit = 'Choose a dose unit.';
  }
  if (!DOSAGE_ROUTE_OPTIONS.some((r) => r.value === values.route)) errors.route = 'Choose a route.';
  if (!DOSAGE_FREQUENCY_OPTIONS.some((f) => f.value === values.frequency)) {
    errors.frequency = 'Choose how often it is taken.';
  }
  if (!DOSAGE_TIMING_OPTIONS.some((t) => t.value === values.timing)) {
    errors.timing = 'Choose a timing.';
  }

  if (values.frequency === 'custom') {
    if (!values.customFrequencyEn.trim()) {
      errors.customFrequencyEn = 'Describe the custom schedule in English.';
    }
    if (!values.customFrequencyAr.trim()) {
      errors.customFrequencyAr = 'Describe the custom schedule in Arabic.';
    }
  }

  if (values.durationDays.trim() !== '') {
    const days = Number(values.durationDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      errors.durationDays = 'Enter a whole number of days from 1 to 365, or leave blank.';
    }
  }

  if (values.additionalInstructionsEn.length > 500) {
    errors.additionalInstructionsEn = 'Additional instructions are too long (max 500).';
  }
  if (values.additionalInstructionsAr.length > 500) {
    errors.additionalInstructionsAr = 'Additional instructions are too long (max 500).';
  }

  return errors;
}

// Live preview for the form: same generator the saved row and printed snapshot use.
export function buildDosagePreview(values: DosageFormValues): { textEn: string; textAr: string } {
  return buildDosageText(formToDosageInput(values));
}

// A warning, not a save blocker: two products may legitimately share the exact same directions,
// but a duplicate with no such reason is usually an accidental re-entry, so the form points it out
// immediately and names the existing code.
export function duplicateDosageText(
  dosages: DosageInstruction[],
  input: DosageInstructionInput,
  editingId?: string
): DosageInstruction | undefined {
  const { textEn } = buildDosageText(input);
  const key = textEn.trim().toLowerCase();
  if (!key) return undefined;
  return dosages.find((dosage) => {
    if (dosage.id === editingId) return false;
    return buildDosageText(dosage).textEn.trim().toLowerCase() === key;
  });
}

export function snapshotDosage(dosage: DosageInstruction): DosageSnapshot {
  const input: DosageInstructionInput = {
    doseAmount: dosage.doseAmount,
    doseUnit: dosage.doseUnit,
    route: dosage.route,
    frequency: dosage.frequency,
    customFrequencyAr: dosage.customFrequencyAr,
    customFrequencyEn: dosage.customFrequencyEn,
    timing: dosage.timing,
    durationDays: dosage.durationDays,
    additionalInstructionsAr: dosage.additionalInstructionsAr,
    additionalInstructionsEn: dosage.additionalInstructionsEn,
  };
  return {
    ...input,
    dosageId: dosage.id,
    code: dosage.code,
    ...buildDosageText(input),
  };
}

// ---- Persist merge ----------------------------------------------------------------------------
// Keeps the owner's edits, assigns a code to rows saved before numbering existed, and appends any
// NEW seed instruction so an existing browser session still sees the starter library.
export function mergeDosageMaster(
  persisted: DosageInstruction[] | undefined,
  seeds: DosageInstruction[]
): DosageInstruction[] {
  const base = persisted ?? seeds;
  const seedById = new Map(seeds.map((d) => [d.id, d]));
  let seq = maxDosageNumber([...base, ...seeds]) + 1;

  const merged = base.map((dosage) => {
    const seed = seedById.get(dosage.id);
    const row = seed ? { ...seed, ...dosage } : dosage;
    if (row.code) return row;
    return { ...row, code: seed?.code ?? formatDosageCode(seq++) };
  });

  const ids = new Set(merged.map((d) => d.id));
  return [...merged, ...seeds.filter((d) => !ids.has(d.id))];
}

// ---- Printing ---------------------------------------------------------------------------------
export interface DosageSaleLine {
  itemId: string;
  itemNameAr: string;
  itemNameEn: string;
  qty: number;
  unit?: string;
  dosage?: DosageSnapshot;
}

export interface DosagePrintGroup {
  key: string;
  itemId: string;
  itemNameAr: string;
  itemNameEn: string;
  qty: number;
  unit?: string;
  dosage: DosageSnapshot;
}

// A receipt collapses batch-split lines per item. The dosage sheet does the same, but keeps a
// separate block when the pharmacist deliberately chose different directions for two lines of the
// same product — merging those would print two contradictory instructions as one.
export function groupDosageLines(lines: DosageSaleLine[]): DosagePrintGroup[] {
  const groups = new Map<string, DosagePrintGroup>();
  for (const line of lines) {
    if (!line.dosage) continue;
    const dosageKey = line.dosage.dosageId ?? line.dosage.code ?? line.dosage.textEn;
    const key = `${line.itemId}::${line.unit ?? ''}::${dosageKey}::${line.dosage.textEn}`;
    const existing = groups.get(key);
    if (existing) {
      existing.qty += line.qty;
      continue;
    }
    groups.set(key, {
      key,
      itemId: line.itemId,
      itemNameAr: line.itemNameAr,
      itemNameEn: line.itemNameEn,
      qty: line.qty,
      unit: line.unit,
      dosage: line.dosage,
    });
  }
  return [...groups.values()];
}

export function hasDosages(lines: { dosage?: DosageSnapshot }[]): boolean {
  return lines.some((line) => !!line.dosage);
}

export function dosageRouteLabel(route: DosageRoute): string {
  return DOSAGE_ROUTE_OPTIONS.find((r) => r.value === route)?.labelEn ?? route;
}

export function dosageFrequencyLabel(frequency: DosageFrequency): string {
  return DOSAGE_FREQUENCY_OPTIONS.find((f) => f.value === frequency)?.labelEn ?? frequency;
}

export function dosageTimingLabel(timing: DosageTiming): string {
  return DOSAGE_TIMING_OPTIONS.find((t) => t.value === timing)?.labelEn ?? timing;
}

export function dosageDoseUnitLabel(unit: DosageDoseUnit): string {
  return unitDefinition(unit).labelEn;
}
