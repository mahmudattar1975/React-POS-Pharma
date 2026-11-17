// One place for how a prescription status is shown, so the POS dialog, the registry list and the
// detail view never describe the same status differently.
import type { PrescriptionStatus } from '../types/prescriptions';

export const PRESCRIPTION_STATUS_LABEL: Record<PrescriptionStatus, string> = {
  active: 'Active',
  partially_dispensed: 'Partially dispensed',
  dispensed: 'Dispensed',
  expired: 'Expired',
  cancelled: 'Cancelled',
  blocked: 'Blocked',
};

export const PRESCRIPTION_STATUS_COLOR: Record<
  PrescriptionStatus,
  'success' | 'info' | 'default' | 'warning' | 'error'
> = {
  active: 'success',
  partially_dispensed: 'info',
  dispensed: 'default',
  expired: 'warning',
  cancelled: 'error',
  blocked: 'error',
};
