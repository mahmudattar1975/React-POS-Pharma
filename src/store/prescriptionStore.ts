// Local prescription registry (represcription.md §7). Same local-first pattern as salesStore: zustand
// + persist, no backend. One record per prescription, many dispense events behind it, so a 30-tablet
// prescription filled 10 + 20 stays one auditable record instead of three unrelated invoices.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  DispenseEvent, Prescription, PrescriptionInput, PrescriptionStatus,
} from '../types/prescriptions';
import {
  DEFAULT_VALIDITY_DAYS, applyDispense, expiryFor, statusFor, todayIso,
} from '../utils/prescriptionRules';

interface PrescriptionState {
  prescriptions: Prescription[];
  addPrescription: (input: PrescriptionInput) => Prescription;
  updatePrescription: (id: string, patch: Partial<Prescription>) => void;
  setStatus: (id: string, status: PrescriptionStatus) => void;
  // Applies one fill: advances every line's dispensed quantity and appends the event. Returns the
  // updated record so the caller can show the post-dispense state without re-reading the store.
  // `today` is only passed by tests and back-dated imports; the POS always uses the real date.
  recordDispense: (id: string, event: DispenseEvent, today?: string) => Prescription | undefined;
  byId: (id: string) => Prescription | undefined;
  byNo: (prescriptionNo: string) => Prescription | undefined;
  search: (query: string) => Prescription[];
}

export const usePrescriptionStore = create<PrescriptionState>()(
  persist(
    (set, get) => ({
      prescriptions: [],

      addPrescription: (input) => {
        const now = new Date().toISOString();
        const validityDays = input.validityDays ?? DEFAULT_VALIDITY_DAYS;
        const prescription: Prescription = {
          id: crypto.randomUUID(),
          prescriptionNo: input.prescriptionNo.trim(),
          source: input.source,
          wasfatyReferenceNo: input.wasfatyReferenceNo?.trim() || undefined,
          patientNationalId: input.patientNationalId.trim(),
          patientName: input.patientName,
          prescriberId: input.prescriberId,
          prescriberName: input.prescriberName.trim(),
          issuedDate: input.issuedDate,
          expiryDate: expiryFor(input.issuedDate, validityDays),
          validityDays,
          status: 'active',
          lines: input.lines.map((line) => ({
            id: crypto.randomUUID(),
            ...line,
            quantityDispensed: 0,
            substitutionAllowed: line.substitutionAllowed ?? true,
          })),
          dispenseEvents: [],
          notes: input.notes,
          createdAt: now,
          createdBy: input.createdBy,
        };
        set((s) => ({ prescriptions: [...s.prescriptions, prescription] }));
        return prescription;
      },

      updatePrescription: (id, patch) => {
        set((s) => ({
          prescriptions: s.prescriptions.map((rx) => (rx.id === id ? { ...rx, ...patch } : rx)),
        }));
      },

      setStatus: (id, status) => {
        set((s) => ({
          prescriptions: s.prescriptions.map((rx) => (rx.id === id ? { ...rx, status } : rx)),
        }));
      },

      recordDispense: (id, event, today) => {
        const rx = get().prescriptions.find((candidate) => candidate.id === id);
        if (!rx) return undefined;
        const updated = applyDispense(rx, event, today ?? todayIso());
        set((s) => ({
          prescriptions: s.prescriptions.map((candidate) => (candidate.id === id ? updated : candidate)),
        }));
        return updated;
      },

      byId: (id) => get().prescriptions.find((rx) => rx.id === id),

      byNo: (prescriptionNo) => {
        const wanted = prescriptionNo.trim().toLowerCase();
        if (!wanted) return undefined;
        return get().prescriptions.find((rx) => rx.prescriptionNo.toLowerCase() === wanted);
      },

      // Searches the identifiers a pharmacist actually has in hand at the counter: prescription
      // number, national ID / Iqama, Wasfaty reference, or patient name. Masked IDs stay masked in
      // the UI; the raw digits never leave this local store.
      search: (query) => {
        const wanted = query.trim().toLowerCase();
        if (!wanted) return get().prescriptions;
        return get().prescriptions.filter((rx) =>
          rx.prescriptionNo.toLowerCase().includes(wanted) ||
          rx.patientNationalId.includes(wanted) ||
          (rx.wasfatyReferenceNo?.toLowerCase().includes(wanted) ?? false) ||
          (rx.patientName?.toLowerCase().includes(wanted) ?? false),
        );
      },
    }),
    {
      name: 'pharmacy-prescriptions',
      // Persisted records can be days old, so their stored 'active' status must not outlive the
      // validity window. Statuses the pharmacy set explicitly (cancelled/blocked) are never touched.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const today = todayIso();
        state.prescriptions = state.prescriptions.map((rx) =>
          rx.status === 'cancelled' || rx.status === 'blocked'
            ? rx
            : { ...rx, status: statusFor(rx, today) },
        );
      },
    },
  ),
);
