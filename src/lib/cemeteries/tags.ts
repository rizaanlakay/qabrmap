import type { Cemetery } from '@/types';

const TYPE_TAGS: Record<Cemetery['siteType'], string | null> = {
  muslim_cemetery: null,
  muslim_section: 'Muslim section',
  shared_cemetery: 'Shared cemetery',
  historic_cemetery: 'Historic',
};

// Short labels for the cemetery card; a dedicated active cemetery gets none
export function cemeteryTags(cemetery: Pick<Cemetery, 'siteType' | 'siteStatus'>): string[] {
  const tags: string[] = [];
  const typeTag = TYPE_TAGS[cemetery.siteType];
  if (typeTag) tags.push(typeTag);
  if (cemetery.siteStatus === 'closed') tags.push('Closed');
  return tags;
}
