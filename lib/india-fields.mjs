/**
 * india-fields.mjs — read Indian job-listing details from free text:
 * salary in LPA / Lacs / Cr (to an INR range), years of experience, and
 * Indian city / Remote / Hybrid. Shared by the Indian job-site importers.
 *
 * No imports and no Node-only APIs, so a browser bundle can load it.
 */

const LAKH = 100_000;
const CRORE = 10_000_000;

/**
 * Rupee range from Naukri salary text. "12-18 Lacs PA", "₹ 30-45 LPA",
 * "1-1.5 Cr", "8,00,000 - 12,00,000 P.A." → {min, max, currency: 'INR'}.
 * "Not disclosed" and anything unreadable → null.
 *
 * @param {string} text
 * @returns {{min: number, max: number, currency: 'INR'}|null}
 */
export function parseIndianSalary(text) {
  if (typeof text !== 'string') return null;
  const t = text.replace(/₹|INR|Rs\.?/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!t || /not\s+disclosed/i.test(t)) return null;
  const unit = /\b(cr|crore|crores)\b/i.test(t)
    ? CRORE
    : /\b(lpa|lac|lacs|lakh|lakhs|l)\b/i.test(t) ? LAKH : 1;
  const nums = [...t.matchAll(/\d[\d,]*(?:\.\d+)?/g)]
    .map((m) => Number(m[0].replace(/,/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return null;
  const [a, b = a] = nums;
  const min = Math.round(Math.min(a, b) * unit);
  const max = Math.round(Math.max(a, b) * unit);
  // A plain-rupee figure under 50,000 is a monthly stipend or noise; skip it.
  if (unit === 1 && max < 50_000) return null;
  return { min, max, currency: 'INR' };
}

/**
 * Experience label from "5-8 Yrs", "3 to 5 years", "Fresher", "0-1 Yrs".
 *
 * @param {string} text
 * @returns {string|null}
 */
export function parseExperience(text) {
  if (typeof text !== 'string') return null;
  if (/\bfreshers?\b/i.test(text)) return 'fresher';
  const range = text.match(/(\d+)\s*(?:-|–|to)\s*(\d+)\s*(?:yrs?|years?)\b/i);
  if (range) return `${range[1]}-${range[2]}`;
  const plus = text.match(/(\d+)\s*\+?\s*(?:yrs?|years?)\b/i);
  return plus ? `${plus[1]}+` : null;
}

export const INDIAN_CITIES = [
  'Bengaluru', 'Bangalore', 'Mumbai', 'Navi Mumbai', 'Thane', 'Pune', 'Hyderabad', 'Secunderabad',
  'Chennai', 'Delhi', 'New Delhi', 'Delhi NCR', 'NCR', 'Gurugram', 'Gurgaon', 'Noida',
  'Greater Noida', 'Ghaziabad', 'Faridabad', 'Kolkata', 'Ahmedabad', 'Gandhinagar', 'Jaipur',
  'Chandigarh', 'Mohali', 'Panchkula', 'Indore', 'Bhopal', 'Lucknow', 'Kanpur', 'Nagpur',
  'Coimbatore', 'Kochi', 'Cochin', 'Thiruvananthapuram', 'Trivandrum', 'Mysuru', 'Mysore',
  'Mangaluru', 'Mangalore', 'Visakhapatnam', 'Vizag', 'Vijayawada', 'Bhubaneswar', 'Surat',
  'Vadodara', 'Nashik', 'Aurangabad', 'Ludhiana', 'Amritsar', 'Dehradun', 'Patna', 'Ranchi',
  'Guwahati', 'Goa', 'Madurai', 'Hubli', 'Raipur',
];

const CITY_PATTERN = new RegExp(
  `\\b(${[...INDIAN_CITIES].sort((a, b) => b.length - a.length).map((c) => c.replace(/ /g, '\\s+')).join('|')})\\b`,
  'gi',
);

/**
 * Location text from a line: the Indian cities it names, plus Remote/Hybrid.
 *
 * @param {string} text
 * @returns {string|null}
 */
export function parseLocation(text) {
  if (typeof text !== 'string') return null;
  const cities = [];
  for (const m of text.matchAll(CITY_PATTERN)) {
    const canon = INDIAN_CITIES.find((c) => c.toLowerCase() === m[1].replace(/\s+/g, ' ').toLowerCase());
    if (canon && !cities.includes(canon)) cities.push(canon);
  }
  const mode = /\b(work\s+from\s+home|wfh|remote)\b/i.test(text)
    ? 'Remote'
    : /\bhybrid\b/i.test(text) ? 'Hybrid' : '';
  const parts = [...cities];
  if (mode) parts.push(mode);
  return parts.length ? parts.join(', ') : null;
}
