import type { Grave } from '@/types';

// What the person who mapped a grave can correct afterwards: the same details they typed on the Confirm
// screen. Dates are YYYY-MM-DD from a date input, or ''. The position, photos and cemetery are not editable.
export interface GraveEditForm {
  firstName: string;
  middleNames: string;
  surname: string;
  nickname: string;
  graveNumber: string;
  birthDate: string;
  deathDate: string;
}

export interface GraveEditFormErrors {
  firstName?: string;
  surname?: string;
  deathDate?: string;
}

const FIELDS: Array<keyof GraveEditForm> = ['firstName', 'middleNames', 'surname', 'nickname', 'graveNumber', 'birthDate', 'deathDate'];

// Stored dates can carry a time; a date input only takes the day
const dayOf = (value?: string): string => (value ? value.slice(0, 10) : '');

export function graveEditFormFrom(grave: Grave): GraveEditForm {
  const person = grave.person;
  return {
    firstName: person?.firstName ?? '',
    middleNames: person?.middleNames ?? '',
    surname: person?.surname ?? '',
    nickname: person?.nickname ?? '',
    graveNumber: grave.graveNumber ?? '',
    birthDate: dayOf(person?.birthDate),
    deathDate: dayOf(person?.deathDate),
  };
}

// Many stones have no readable details, so only the name is required, as when the grave was mapped
export function validateGraveEditForm(form: GraveEditForm): { valid: boolean; errors: GraveEditFormErrors } {
  const errors: GraveEditFormErrors = {};
  if (!form.firstName.trim()) errors.firstName = 'Enter a first name';
  if (!form.surname.trim()) errors.surname = 'Enter a surname';
  if (form.birthDate && form.deathDate && form.deathDate < form.birthDate) {
    errors.deathDate = 'The date of death is before the date of birth';
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

// Spaces around a value are not a change
export function hasGraveEditChanges(form: GraveEditForm, grave: Grave): boolean {
  const original = graveEditFormFrom(grave);
  return FIELDS.some((field) => form[field].trim() !== original[field].trim());
}
