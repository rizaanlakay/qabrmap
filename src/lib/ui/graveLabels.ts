import type { Grave } from '@/types';

// "Grave 1402", or null when the stone had no visible number
export function graveNumberLabel(grave: Pick<Grave, 'graveNumber'>): string | null {
  const number = grave.graveNumber?.trim();
  return number ? `Grave ${number}` : null;
}
