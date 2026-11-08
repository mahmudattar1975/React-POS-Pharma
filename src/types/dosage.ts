// Dosage instructions (DOS / SIG) — the patient-facing directions a pharmacist attaches to a
// dispensed item: how much, by which route, how often, when, and for how long.
//
// Why this is a reusable master and not free text on each item:
//   • the same instruction ("1 tablet twice daily after food for 5 days") is used by many products;
//   • the item master can link several suitable instructions and mark one as suggested;
//   • the pharmacist still chooses per patient at the till (DOS is optional on every line);
//   • issued invoices keep a frozen snapshot, so editing the master later never rewrites history.
//
// The print uses plain language ("twice daily", not "BID") because error-prone prescription
// abbreviations are discouraged for patient directions (BNF/Joint Commission/ISMP guidance). The
// structured fields below are what generate that plain bilingual sentence.
export type DosageRoute =
  | 'oral'
  | 'topical'
  | 'ophthalmic'
  | 'otic'
  | 'nasal'
  | 'inhalation'
  | 'rectal'
  | 'vaginal'
  | 'sublingual'
  | 'injection'
  | 'other';

export type DosageFrequency =
  | 'once_daily'
  | 'twice_daily'
  | 'three_times_daily'
  | 'four_times_daily'
  | 'every_4_hours'
  | 'every_6_hours'
  | 'every_8_hours'
  | 'every_12_hours'
  | 'every_other_day'
  | 'once_weekly'
  | 'as_needed'
  | 'custom';

export type DosageTiming =
  | 'none'
  | 'before_food'
  | 'with_food'
  | 'after_food'
  | 'empty_stomach'
  | 'morning'
  | 'evening'
  | 'bedtime';

export type DosageDoseUnit =
  | 'tablet'
  | 'capsule'
  | 'ml'
  | 'drop'
  | 'puff'
  | 'spray'
  | 'application'
  | 'sachet'
  | 'suppository'
  | 'patch'
  | 'vial'
  | 'unit';

export interface DosageInstructionInput {
  doseAmount: string; // "1", "5", "2" — kept as text so a half/tapered dose is not forced to an integer
  doseUnit: DosageDoseUnit;
  route: DosageRoute;
  frequency: DosageFrequency;
  // Required together only when frequency === 'custom' — lets a prescriber's unusual schedule be
  // written in both languages rather than falling back to English on an Arabic leaflet.
  customFrequencyAr?: string;
  customFrequencyEn?: string;
  timing: DosageTiming;
  durationDays?: number; // undefined = no fixed course / until finished
  // Anything the structured builder cannot express ("Do not exceed 8 tablets in 24 hours",
  // "Shake well before use", "Dissolve in a glass of water"). Printed after the main sentence.
  additionalInstructionsAr?: string;
  additionalInstructionsEn?: string;
}

export interface DosageInstruction extends DosageInstructionInput {
  id: string;
  // System-assigned, stable display key (DOS-000001). Editing the wording never changes the code.
  code: string;
  // undefined = active, matching Item.isActive and every other master in the app.
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// What is frozen onto a sale line at the moment the pharmacist chooses it. The generated text is
// stored beside the structured fields because it is what was actually printed/dispensed: a later
// change to the master, labels or generator must not alter an already-issued instruction sheet.
export type DosageSnapshot = Omit<
  DosageInstruction,
  'id' | 'isActive' | 'createdAt' | 'updatedAt'
> & {
  dosageId?: string; // master id, for analytics/drift checks; optional so an old/manual row is valid
  textAr: string;
  textEn: string;
};
