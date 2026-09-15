// What a user enters on the Confirm screen. Dates are YYYY-MM-DD from a date input, or ''.
export interface NewGraveForm {
  firstName: string;
  middleNames: string;
  surname: string;
  nickname: string;
  graveNumber: string;
  birthDate: string;
  deathDate: string;
  cemeteryId: string;
}

export interface NewGraveFormErrors {
  firstName?: string;
  surname?: string;
  cemeteryId?: string;
}

// Many stones have no readable details, so only the name and cemetery are required
export function validateNewGraveForm(form: NewGraveForm): { valid: boolean; errors: NewGraveFormErrors } {
  const errors: NewGraveFormErrors = {};
  if (!form.firstName.trim()) errors.firstName = 'Enter a first name';
  if (!form.surname.trim()) errors.surname = 'Enter a surname';
  if (!form.cemeteryId) errors.cemeteryId = 'Choose a cemetery';
  return { valid: Object.keys(errors).length === 0, errors };
}
