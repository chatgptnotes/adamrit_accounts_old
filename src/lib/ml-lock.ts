/**
 * M.L. Enterprises is the super admin's private set of books. The company is
 * hidden from every company list until it is unlocked with the password, per
 * session (closing the tab locks it again).
 *
 * This is a front-door gate for the office, not cryptographic security — the
 * data itself still sits in the shared database.
 */

const STORAGE_KEY = 'adamrit_ml_unlocked';
const PASSWORD = '2605';

export const ML_COMPANY_KEY = 'ml_enterprises';

export const isMlUnlocked = (): boolean => {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

/** True when the password matched and the session is now unlocked. */
export const unlockMl = (password: string): boolean => {
  if (password.trim() !== PASSWORD) return false;
  try {
    sessionStorage.setItem(STORAGE_KEY, '1');
  } catch {
    return false;
  }
  return true;
};

export const lockMl = (): void => {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to lock */
  }
};
