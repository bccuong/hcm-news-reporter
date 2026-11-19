/**
 * Ids of filter suggestions that "Bỏ qua" accepts (local server + review worker): `<kind>:<phrase>`,
 * one prefix per FilterSuggestion kind (suggest.ts). Kept in its own file so the worker bundle stays small.
 * "sector" / "setting" were missing here until 19/11/2026, so those suggestions could not be dismissed.
 */
export const SUGGESTION_KINDS = ['include', 'exclude_title', 'place', 'sector', 'setting'] as const;
export const SUGGESTION_ID = new RegExp(`^(${SUGGESTION_KINDS.join('|')}):.{1,200}$`, 'u');
