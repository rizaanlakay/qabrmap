import { describe, it, expect } from 'vitest';
import { graveNumberLabel } from '../src/lib/ui/graveLabels';
import { escapeHtml } from '../src/lib/ui/escapeHtml';

describe('Grave Label Tests', () => {
  it('labels a grave by its number', () => {
    expect(graveNumberLabel({ graveNumber: '1402' })).toBe('Grave 1402');
    expect(graveNumberLabel({ graveNumber: ' 1402 ' })).toBe('Grave 1402');
  });

  it('has no label for a stone without a visible number', () => {
    expect(graveNumberLabel({ graveNumber: '' })).toBeNull();
    expect(graveNumberLabel({ graveNumber: '   ' })).toBeNull();
  });

  it('escapes text typed by users before it goes into marker HTML', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(escapeHtml("Abdul 'Boeta' & Sons")).toBe('Abdul &#39;Boeta&#39; &amp; Sons');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(null)).toBe('');
  });
});
