import { describe, it, expect } from 'vitest';
import { REMEMBRANCE_QUOTES } from '../src/components/common/RemembranceQuoteCarousel';

describe('Remembrance Quotes Auto-Cycling Carousel Tests', () => {
  it('contains at least 5 meaningful death and remembrance quotes', () => {
    expect(REMEMBRANCE_QUOTES.length).toBeGreaterThanOrEqual(5);
  });

  it('includes core Islamic death-related scriptures & hadiths', () => {
    const sources = REMEMBRANCE_QUOTES.map((q) => q.source);
    
    // Every soul shall taste death (3:185)
    expect(sources.some((s) => s.includes('3:185'))).toBe(true);

    // 3 ongoing deeds after death (Muslim 1631)
    expect(sources.some((s) => s.includes('1631'))).toBe(true);

    // Visiting graves reminder (Muslim 977)
    expect(sources.some((s) => s.includes('977'))).toBe(true);

    // Belong to Allah and return to Him (2:156)
    expect(sources.some((s) => s.includes('2:156'))).toBe(true);

    // Destroyer of pleasures (Tirmidhi 2307)
    expect(sources.some((s) => s.includes('2307'))).toBe(true);
  });

  it('provides arabic excerpts and category labels for all quotes', () => {
    for (const quote of REMEMBRANCE_QUOTES) {
      expect(quote.id).toBeDefined();
      expect(quote.text.length).toBeGreaterThan(15);
      expect(quote.source).toBeDefined();
      expect(quote.category).toBeDefined();
      expect(quote.arabic).toBeDefined();
      expect(quote.arabic?.length).toBeGreaterThan(3);
    }
  });
});
