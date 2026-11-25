import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_BRANCH_ID, defaultBranchById } from './branches.js';

// Per-terminal branch selection. This is the ONLY place a PC declares which pharmacy it is:
// Settings > Branches manages the shared list, but a cashier cannot switch branches at the till.
// The file is gitignored so four machines can each carry a different value.
const CONFIG_PATH = resolve(process.cwd(), 'config', 'branch.json');

interface LoadedBranch {
  id: string;
  configured: boolean;
  warning?: string;
}

function load(): LoadedBranch {
  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, 'utf8');
  } catch {
    return {
      id: DEFAULT_BRANCH_ID,
      configured: false,
      warning: `No ${CONFIG_PATH}; using ${DEFAULT_BRANCH_ID}. Copy config/branch.example.json to branch.json and set this terminal's branch.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { id: DEFAULT_BRANCH_ID, configured: false, warning: `${CONFIG_PATH} is not valid JSON; using ${DEFAULT_BRANCH_ID}.` };
  }

  const id = (parsed as { branchId?: unknown })?.branchId;
  if (typeof id !== 'string' || !id.trim()) {
    return { id: DEFAULT_BRANCH_ID, configured: false, warning: `${CONFIG_PATH} has no branchId; using ${DEFAULT_BRANCH_ID}.` };
  }
  const branchId = id.trim();
  // The shared master may contain a branch this build has never seen. Accept it: the code prefix
  // is read from the DB (or the fallback list) at request time, and an unknown id only means the
  // offline fallback cannot name it - it must not stop the till from opening.
  const known = defaultBranchById(branchId);
  return {
    id: branchId,
    configured: true,
    warning: known ? undefined : `${CONFIG_PATH} selects unknown branch ${branchId}; the shared branch list will be used when available.`,
  };
}

export const terminalBranch = load();

if (terminalBranch.warning) console.warn(`[branch] ${terminalBranch.warning}`);
