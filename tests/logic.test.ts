import { describe, expect, it } from 'vitest';
import { renderTemplate, renameToken, tokensIn, formatDate, parseDate } from '../src/lib/template';
import { layoutText } from '../src/lib/layout';
import { DEFAULT_STYLE, type AcroField, type Form, type FormSet } from '../src/lib/types';
import { buildTruckingForm } from '../src/lib/starter';
import { effectiveValues, visibleKeys, rawValues } from '../src/lib/values';
import { exportDataText, parseDataText } from '../src/lib/textdata';
import { normalizeName, suggestMappings } from '../src/lib/automap';

const mono = (t: string, s: number) => t.length * s * 0.5;

describe('templates', () => {
  it('renders tokens, filters and default date format', () => {
    const ctx = { values: { a: 'alex', d: '2026-03-05', n: '38500', p: '5551234567' }, types: { d: 'date' as const } };
    expect(renderTemplate('{a|upper} {a|title}', ctx)).toBe('ALEX Alex');
    expect(renderTemplate('{d}', ctx)).toBe('03/05/2026');
    expect(renderTemplate('{d|date:MMM D, YY}', ctx)).toBe('Mar 5, 26');
    expect(renderTemplate('{n|number} lbs', ctx)).toBe('38,500 lbs');
    expect(renderTemplate('{p|phone}', ctx)).toBe('(555) 123-4567');
  });
  it('renders nothing when every token is empty', () => {
    expect(renderTemplate('{city}, {state}', { values: {} })).toBe('');
    expect(renderTemplate('{city}, {state}', { values: { city: 'Austin' } })).toBe('Austin, ');
  });
  it('finds and renames tokens keeping filters', () => {
    expect(tokensIn('{a} and {b|upper}')).toEqual(['a', 'b']);
    expect(renameToken('{a|date:MM/DD} {ab}', 'a', 'z')).toBe('{z|date:MM/DD} {ab}');
  });
  it('parses common date spellings', () => {
    expect(formatDate(parseDate('10/13/26')!, 'YYYY-MM-DD')).toBe('2026-10-13');
    expect(formatDate(parseDate('2026-1-2')!, 'YYYY-MM-DD')).toBe('2026-01-02');
  });
});

describe('layout', () => {
  it('auto-fits a single line to the box width', () => {
    const l = layoutText('x'.repeat(30), 100, 20, DEFAULT_STYLE, mono);
    expect(l.overflow).toBe(false);
    expect(l.lines).toHaveLength(1);
    expect(l.lines[0].width).toBeLessThanOrEqual(100 - 4 + 0.01);
  });
  it('flags text that cannot fit even at the minimum size', () => {
    expect(layoutText('x'.repeat(100), 100, 20, DEFAULT_STYLE, mono).overflow).toBe(true);
  });
  it('wraps and shrinks multi-line text to fit the height', () => {
    const style = { ...DEFAULT_STYLE, multiline: true };
    const l = layoutText('word '.repeat(60).trim(), 120, 40, style, mono);
    expect(l.lines.length).toBeGreaterThan(1);
    expect(l.lines.length * l.size * 1.15).toBeLessThanOrEqual(40);
  });
  it('right-aligns', () => {
    const l = layoutText('abc', 100, 14, { ...DEFAULT_STYLE, size: 10, align: 'right' }, mono);
    expect(l.lines[0].x + l.lines[0].width).toBeCloseTo(98);
  });
});

function sampleFormAndSets(): { form: Form; sets: FormSet[] } {
  const form = buildTruckingForm('Test', ['driver', 'carrier', 'equipment', 'load']);
  form.globalValues = { driver_name: 'Alex Rivera' };
  const base = { formId: form.id, docIds: [], createdAt: 0, updatedAt: 0, color: '#000' };
  return {
    form,
    sets: [
      { ...base, id: 's1', name: 'Employer A · Truck 12', values: { truck_number: '12', driver_type: 'Company driver' }, loadValues: { load_number: 'L-1', hazmat: '' } },
      { ...base, id: 's2', name: 'Employer B', values: { truck_number: '7' }, loadValues: {} },
    ],
  };
}

describe('conditional visibility', () => {
  it('hides dependent fields and blanks them for filling', () => {
    const { form, sets } = sampleFormAndSets();
    const s = { ...sets[0], loadValues: { ...sets[0].loadValues, hazmat_contact: '911' } };
    expect(visibleKeys(form, rawValues(form, s)).has('hazmat_contact')).toBe(false);
    expect(effectiveValues(form, s).hazmat_contact).toBe('');
    const on = { ...s, loadValues: { ...s.loadValues, hazmat: 'true' } };
    expect(effectiveValues(form, on).hazmat_contact).toBe('911');
  });
});

describe('text data files', () => {
  it('round-trips without changes', () => {
    const { form, sets } = sampleFormAndSets();
    const text = exportDataText(form, sets);
    const parsed = parseDataText(text, form, sets);
    expect(parsed.changes).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });
  it('reads hand edits forgivingly', () => {
    const { form, sets } = sampleFormAndSets();
    const text = [
      '[Shared]',
      'Driver_Name = Alex J. Rivera',
      '[Set: employer a · truck 12]',
      'Truck / unit #: 15',
      '[Load: Employer A · Truck 12]',
      'hazmat: YES',
      'pickup_date: 10/13/26',
      'notes: line one',
      '  line two',
      'freight_terms: collect',
      'nonsense here',
      'unknown_field: 1',
      '[Set: Brand New]',
      'truck_number: 99',
    ].join('\n');
    const p = parseDataText(text, form, sets);
    const by = Object.fromEntries(p.changes.map((c) => [c.key + '@' + (c.target === 'global' ? 'g' : c.target.setName), c.to]));
    expect(by['driver_name@g']).toBe('Alex J. Rivera');
    expect(by['truck_number@employer a · truck 12']).toBe('15');
    expect(by['hazmat@Employer A · Truck 12']).toBe('true');
    expect(by['pickup_date@Employer A · Truck 12']).toBe('2026-10-13');
    expect(by['notes@Employer A · Truck 12']).toBe('line one\nline two');
    expect(by['freight_terms@Employer A · Truck 12']).toBe('Collect');
    expect(p.newSets).toEqual(['Brand New']);
    expect(p.warnings.some((w) => w.includes('nonsense'))).toBe(true);
    expect(p.warnings.some((w) => w.includes('unknown_field'))).toBe(true);
  });
});

describe('auto-map', () => {
  const acro = (name: string, kind: AcroField['kind'] = 'text', label?: string): AcroField => ({ name, kind, label, widgets: [{ page: 0, rect: [0, 0, 50, 12] }] });
  it('normalizes typical PDF field names', () => {
    expect(normalizeName('Pickup Date_af_date').tokens).toEqual(['pickup', 'date']);
    expect(normalizeName('B/L#').tokens).toContain('bol');
    expect(normalizeName('PiecesRow2').index).toBe(2);
  });
  it('maps common BOL fields and avoids bad guesses', () => {
    const { form } = sampleFormAndSets();
    const fields = [
      acro('Pickup Date_af_date'),
      acro('BL'),
      acro('LOAD'),
      acro('Trailer'),
      acro('Weight lbs'),
      acro('Description_2'),
      acro('Authorized Signature Driver'),
      acro('Authorized Signature Shipper'),
      acro('HazCheck1', 'checkbox'),
      acro('Pcs TypeRow1.0', 'dropdown'),
    ];
    const got = Object.fromEntries(suggestMappings(form, fields).map((s) => [s.acro.name, s.field.key]));
    expect(got['Pickup Date_af_date']).toBe('pickup_date');
    expect(got['BL']).toBe('bol_number');
    expect(got['LOAD']).toBe('load_number');
    expect(got['Trailer']).toBe('trailer_number');
    expect(got['Weight lbs']).toBe('weight');
    expect(got['Authorized Signature Driver']).toBe('driver_signature');
    expect(got['HazCheck1']).toBe('hazmat');
    expect(got['Description_2']).toBeUndefined(); // table row 2+
    expect(got['Authorized Signature Shipper']).toBeUndefined(); // not the driver's signature
    expect(got['Pcs TypeRow1.0']).toBeUndefined(); // code list, not a count
  });
});
