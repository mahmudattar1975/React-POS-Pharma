// The prescription label a patient takes home (represcription.md §5 "Dose instructions and label").
//
// This is a different document from the existing directions label (components/POS/DosagePrintView):
// that one is the item + how to take it, nothing else. An SFDA-shaped dispensing label also has to
// identify the patient, the prescription, the quantity, the batch/expiry and - the field a refill
// pharmacy keeps getting wrong - how many refills remain. That is what this builds.
//
// Everything is derived from frozen snapshots: the prescription's lines (directions captured at
// dispense time) and the dispense event (quantity, batch, expiry of THIS fill). Reprinting months
// later therefore shows what was actually handed over, not what the catalog or DOS master says now.
import type { DosageSnapshot } from '../types/dosage';
import type { DispenseEvent, Prescription, PrescriptionLine } from '../types/prescriptions';
import { buildDosageLabel } from './dosages';
import { formatQty } from './format';
import { lineRemaining, refillsLeft } from './prescriptionRules';
import { maskNationalId } from './wasfaty';

export interface LabelStore {
  nameEn: string;
  nameAr: string;
  address?: string;
  phone?: string;
  branchName?: string;
}

export interface PrescriptionLabel {
  key: string;
  storeNameEn: string;
  storeNameAr: string;
  // "Address · phone" - whatever the store has configured. The label keeps a contact line even
  // when it is only the address, because that is what a patient needs to call or return to.
  contact?: string;
  prescriptionNo: string;
  patientName: string;
  patientId: string; // masked - a 50mm label is not a place for a full national ID
  itemNameEn: string;
  itemNameAr: string;
  directionsEn: string;
  directionsAr: string;
  // True when the prescription carried real directions; the component uses this to keep the
  // fallback line ("use as directed") visually quieter than a real sig.
  hasDirections: boolean;
  durationEn?: string;
  durationAr?: string;
  additionalEn?: string;
  additionalAr?: string;
  quantityEn: string;
  quantityAr: string;
  refillsLeft: number;
  refillsEn: string;
  refillsAr: string;
  fillEn: string;
  fillAr: string;
  dispensedDate: string;
  batchNo?: string;
  expiryDate?: string | null;
  prescriberName: string;
  sourceEn: string;
  sourceAr: string;
}

// The standard fallback when no sig was recorded: a blank direction area on a dispensing label is
// dangerous, because it reads as "no instructions" rather than "not written down".
const NO_DIRECTIONS_EN = 'Use as directed';
const NO_DIRECTIONS_AR = 'استخدم حسب التوجيه';

function englishDuration(days: number | undefined): string | undefined {
  if (!days || days < 1) return undefined;
  return days === 1 ? 'for 1 day' : `for ${days} days`;
}

function arabicDuration(days: number | undefined): string | undefined {
  if (!days || days < 1) return undefined;
  if (days === 1) return 'لمدة يوم واحد';
  if (days === 2) return 'لمدة يومين';
  if (days <= 10) return `لمدة ${days} أيام`;
  return `لمدة ${days} يوماً`;
}

function directionsFor(dosage: DosageSnapshot | undefined): { en: string; ar: string; has: boolean } {
  if (!dosage) return { en: NO_DIRECTIONS_EN, ar: NO_DIRECTIONS_AR, has: false };
  const compact = buildDosageLabel(dosage);
  // A snapshot with no usable text (custom schedule left blank) still has to print something.
  return {
    en: compact.labelEn || NO_DIRECTIONS_EN,
    ar: compact.labelAr || NO_DIRECTIONS_AR,
    has: Boolean(compact.labelEn || compact.labelAr),
  };
}

function contactFor(store: LabelStore): string | undefined {
  const parts = [store.branchName, store.address, store.phone].map((part) => part?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function fillFor(event: DispenseEvent | undefined, line: PrescriptionLine): { qty: number; batchNo?: string; expiryDate?: string | null } {
  const eventLine = event?.lines.find((candidate) => candidate.prescriptionLineId === line.id);
  if (eventLine) return { qty: eventLine.qty, batchNo: eventLine.batchNo, expiryDate: eventLine.expiryDate };
  // No fill yet: the label is a pre-dispense preview. It states one fill's worth (never the whole
  // authorised course, which would over-state what is being handed over today).
  const remaining = lineRemaining(line);
  if (remaining <= 0) return { qty: line.quantityPrescribed };
  return { qty: Math.min(line.quantityPrescribed, remaining) };
}

function fillNumberFor(line: PrescriptionLine): number {
  if (line.quantityPrescribed <= 0) return 1;
  const completed = Math.ceil((line.quantityDispensed - 1e-6) / line.quantityPrescribed);
  return Math.min(1 + line.refillsAuthorized, Math.max(1, completed));
}

function sourceText(rx: Prescription, lang: 'en' | 'ar'): string {
  if (rx.source === 'wasfaty') {
    return lang === 'en'
      ? `Wasfaty${rx.wasfatyReferenceNo ? ` · ${rx.wasfatyReferenceNo}` : ''}`
      : `وصفتي${rx.wasfatyReferenceNo ? ` · ${rx.wasfatyReferenceNo}` : ''}`;
  }
  return lang === 'en' ? 'Private prescription' : 'وصفة خاصة';
}

export interface PrescriptionLabelRequest {
  prescription: Prescription;
  // The fill being labelled. Defaults to the most recent fill; an empty history labels the
  // prescription as it stands today (nothing dispensed).
  event?: DispenseEvent;
  store: LabelStore;
}

function latestEvent(rx: Prescription): DispenseEvent | undefined {
  return rx.dispenseEvents[rx.dispenseEvents.length - 1];
}

// One label per line: a prescription with three items produces three stickers, which is how a
// pharmacy actually labels boxes - each one has to end up on its own package.
export function buildPrescriptionLabels({ prescription, event, store }: PrescriptionLabelRequest): PrescriptionLabel[] {
  const fill = event ?? latestEvent(prescription);
  const contact = contactFor(store);
  const patientId = maskNationalId(prescription.patientNationalId);

  return prescription.lines.map((line) => {
    const { qty, batchNo, expiryDate } = fillFor(fill, line);
    const directions = directionsFor(line.dosage);
    const durationDays = line.dosage?.durationDays ?? line.durationDays;
    const refills = refillsLeft(line);
    const fillNumber = fillNumberFor(line);
    const totalFills = 1 + line.refillsAuthorized;

    return {
      key: `${line.id}::${fill?.id ?? 'no-fill'}`,
      storeNameEn: store.nameEn,
      storeNameAr: store.nameAr,
      contact,
      prescriptionNo: prescription.prescriptionNo,
      patientName: prescription.patientName?.trim() ?? '',
      patientId,
      itemNameEn: line.itemNameEn,
      itemNameAr: line.itemNameAr,
      directionsEn: directions.en,
      directionsAr: directions.ar,
      hasDirections: directions.has,
      durationEn: englishDuration(durationDays),
      durationAr: arabicDuration(durationDays),
      additionalEn: line.dosage?.additionalInstructionsEn,
      additionalAr: line.dosage?.additionalInstructionsAr,
      quantityEn: `Qty ${formatQty(qty)} ${line.unit}`,
      quantityAr: `الكمية ${formatQty(qty)} ${line.unit}`,
      refillsLeft: refills,
      refillsEn: refills === 0 ? 'No refills left' : `Refills left: ${refills}`,
      refillsAr: refills === 0 ? 'لا توجد مرات صرف متبقية' : `مرات الصرف المتبقية: ${refills}`,
      fillEn: `Fill ${fillNumber} of ${totalFills}`,
      fillAr: `الصرف ${fillNumber} من ${totalFills}`,
      dispensedDate: (fill?.dispensedAt ?? prescription.createdAt).slice(0, 10),
      batchNo,
      expiryDate,
      prescriberName: prescription.prescriberName,
      sourceEn: sourceText(prescription, 'en'),
      sourceAr: sourceText(prescription, 'ar'),
    };
  });
}
