import type { ControlledStatus } from '../types/catalog';

export const CONTROLLED_STATUS_LABEL: Record<ControlledStatus, string> = {
  prescription: 'Prescription Required',
  schedule_a: 'Schedule A (Narcotic)',
  schedule_b: 'Schedule B',
  schedule_c: 'Schedule C',
  schedule_d: 'Schedule D',
  schedule_e: 'Schedule E (Locally Controlled)',
};

export const CONTROLLED_STATUS_OPTIONS: ControlledStatus[] = [
  'prescription',
  'schedule_a',
  'schedule_b',
  'schedule_c',
  'schedule_d',
  'schedule_e',
];
