/**
 * Shared sub-group titles per category, for the admin UI's group dropdown.
 * (The build-time classifier in scripts/build-catalog.mjs assigns these to the
 * original catalog items; here we expose the human list for manual selection.)
 */
export const CATEGORY_GROUP_OPTIONS = {
  'social-media': [
    { key: 'holidays', title: 'Holidays & Seasonal' },
    { key: 'programs', title: 'Program Posts' },
    { key: 'testimonials', title: 'Testimonials' },
    { key: 'team', title: 'Team & New Hires' },
    { key: 'personalized', title: 'Personalized & Custom' },
    { key: 'news', title: 'News & Announcements' },
    { key: 'other', title: 'Other' },
  ],
};

export function groupsForCategory(slug) {
  return CATEGORY_GROUP_OPTIONS[slug] || null;
}

// Days a newly-added piece stays highlighted as "Just Added" before it settles
// into its normal category placement.
export const NEW_DAYS = 10;

export function isNew(createdAt, now = Date.now()) {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return false;
  return now - t < NEW_DAYS * 24 * 60 * 60 * 1000;
}
