/** Clinical reference data shared by main (docs, validation) and renderer (UI). */

export interface ConditionDef { key: string; label: string; color: string; glyph: string; group: 'caries' | 'restoration' | 'missing' | 'endodontic' | 'prosthetic' | 'surgical' | 'periodontal' | 'other' }

export const TOOTH_CONDITIONS: ConditionDef[] = [
  { key: 'caries', label: 'Caries', color: '#B42318', glyph: 'C', group: 'caries' },
  { key: 'restored', label: 'Restoration', color: '#175CD3', glyph: 'R', group: 'restoration' },
  { key: 'missing', label: 'Missing', color: '#475467', glyph: 'X', group: 'missing' },
  { key: 'root_canal', label: 'Root canal treated', color: '#7A5AF8', glyph: 'RCT', group: 'endodontic' },
  { key: 'crown', label: 'Crown', color: '#0E7C86', glyph: 'Cr', group: 'prosthetic' },
  { key: 'bridge', label: 'Bridge', color: '#084B63', glyph: 'Br', group: 'prosthetic' },
  { key: 'implant', label: 'Implant', color: '#344054', glyph: 'Im', group: 'prosthetic' },
  { key: 'fracture', label: 'Fracture', color: '#DC6803', glyph: 'F', group: 'other' },
  { key: 'extraction_needed', label: 'Extraction indicated', color: '#D92D20', glyph: 'EX', group: 'surgical' },
  { key: 'abscess', label: 'Abscess / infection', color: '#912018', glyph: 'A', group: 'other' },
  { key: 'periodontal', label: 'Periodontal involvement', color: '#1E7A4B', glyph: 'P', group: 'periodontal' },
  { key: 'mobility', label: 'Mobility', color: '#B26B00', glyph: 'M', group: 'periodontal' },
];

export const CONDITION_KEYS = TOOTH_CONDITIONS.map((c) => c.key);

export function conditionLabel(key: string): string {
  return TOOTH_CONDITIONS.find((c) => c.key === key)?.label ?? key;
}

/** FDI numbering: adult (permanent) + pediatric (primary) dentition. */
export const ADULT_TEETH: string[] = [
  '18', '17', '16', '15', '14', '13', '12', '11',
  '21', '22', '23', '24', '25', '26', '27', '28',
  '48', '47', '46', '45', '44', '43', '42', '41',
  '31', '32', '33', '34', '35', '36', '37', '38',
];

export const PEDIATRIC_TEETH: string[] = [
  '55', '54', '53', '52', '51',
  '61', '62', '63', '64', '65',
  '85', '84', '83', '82', '81',
  '71', '72', '73', '74', '75',
];

export function isPediatricTooth(code: string): boolean {
  return code.startsWith('5') || code.startsWith('6') || code.startsWith('7') || code.startsWith('8') && code.length === 2 && Number(code[0]) >= 5;
}

export function toothDentition(code: string): 'adult' | 'pediatric' {
  const q = Number(code[0]);
  return q >= 5 ? 'pediatric' : 'adult';
}

export function toothArch(code: string): 'upper' | 'lower' {
  const q = Number(code[0]);
  if (q === 1 || q === 2 || q === 5 || q === 6) return 'upper';
  return 'lower';
}

export const GENDERS = ['male', 'female', 'other'] as const;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

export const MEDICINE_FORMS = ['tablet', 'capsule', 'syrup', 'suspension', 'drops', 'gel', 'cream', 'ointment', 'mouthwash', 'injection', 'other'] as const;
export const FREQUENCIES = ['once daily', 'twice daily', 'thrice daily', 'four times daily', 'every 6 hours', 'every 8 hours', 'every 12 hours', 'at bedtime', 'as directed', 'PRN'] as const;
