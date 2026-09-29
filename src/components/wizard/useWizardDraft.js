'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readDraft, writeDraft, clearDraft, readContact } from '@/components/wizard/wizardStorage';

const SAVE_DELAY_MS = 400;

/**
 * Restores a saved draft (or, failing that, remembered contact details) once on
 * mount, then saves the form to sessionStorage as the user types (debounced).
 *
 * Returns:
 *  - restored   true while the "We restored your draft" notice should show
 *  - startOver  discard the draft and reset to a fresh, contact-prefilled form
 *  - finish     call after a successful submit: stops saving and clears the draft
 *  - freshValues  defaults merged with remembered contact details
 */
export function useWizardDraft({ watch, reset, defaultValues }) {
  const [restored, setRestored] = useState(false);
  const timerRef = useRef(null);
  const pausedRef = useRef(false);
  const defaultsRef = useRef(defaultValues);

  const freshValues = useCallback(() => ({ ...defaultsRef.current, ...readContact() }), []);

  useEffect(() => {
    const draft = readDraft();
    if (draft) {
      reset({ ...freshValues(), ...draft });
      setRestored(true);
    } else {
      const contact = readContact();
      if (Object.keys(contact).length) reset({ ...defaultsRef.current, ...contact });
    }
  }, [reset, freshValues]);

  useEffect(() => {
    const subscription = watch((values) => {
      if (pausedRef.current) return;
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => writeDraft(values), SAVE_DELAY_MS);
    });
    return () => {
      subscription.unsubscribe();
      clearTimeout(timerRef.current);
    };
  }, [watch]);

  const startOver = useCallback(() => {
    clearTimeout(timerRef.current);
    clearDraft();
    reset(freshValues());
    setRestored(false);
  }, [reset, freshValues]);

  const finish = useCallback(() => {
    pausedRef.current = true;
    clearTimeout(timerRef.current);
    clearDraft();
    setRestored(false);
  }, []);

  /** Resume saving (after "Submit another request"). */
  const resume = useCallback(() => {
    pausedRef.current = false;
  }, []);

  return { restored, dismissRestored: () => setRestored(false), startOver, finish, resume, freshValues };
}
