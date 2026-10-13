// Exercises the pdf-lib fill engine against generated and real-world PDFs.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { PDFDocument, PDFTextField, PDFCheckBox, StandardFonts } from 'pdf-lib';
import { fillAndMerge, fillPdf, toPdfPoint, type FillJob } from '../src/lib/pdf/fill';
import { DEFAULT_STYLE, type AcroField, type DocPage, type Mapping } from '../src/lib/types';

const page: DocPage = { width: 612, height: 792, rotate: 0, view: [0, 0, 612, 792] };

async function makeForm() {
  const pdf = await PDFDocument.create();
  const p = pdf.addPage([612, 792]);
  const form = pdf.getForm();
  form.createTextField('Name').addToPage(p, { x: 50, y: 700, width: 200, height: 20 });
  form.createTextField('Short').addToPage(p, { x: 50, y: 650, width: 60, height: 20 });
  form.getTextField('Short').setMaxLength(4);
  form.createCheckBox('Agree').addToPage(p, { x: 50, y: 600, width: 12, height: 12 });
  form.createDropdown('Terms').addToPage(p, { x: 50, y: 550, width: 100, height: 20 });
  form.getDropdown('Terms').addOptions(['Prepaid', 'Collect']);
  await pdf.embedFont(StandardFonts.Helvetica);
  return pdf.save();
}

const acroFields: AcroField[] = [
  { name: 'Name', kind: 'text', widgets: [{ page: 0, rect: [50, 72, 200, 20] }] },
  { name: 'Short', kind: 'text', maxLen: 4, widgets: [{ page: 0, rect: [50, 122, 60, 20] }] },
  { name: 'Agree', kind: 'checkbox', widgets: [{ page: 0, rect: [50, 180, 12, 12] }] },
  { name: 'Terms', kind: 'dropdown', options: ['Prepaid', 'Collect'], widgets: [{ page: 0, rect: [50, 222, 100, 20] }] },
];
const m = (field: string, render: Mapping['render'] = 'text'): Mapping => ({ id: field, target: { kind: 'acro', field }, source: '', render, style: DEFAULT_STYLE });

describe('fill engine', () => {
  it('converts display points to PDF space for every rotation', () => {
    expect(toPdfPoint(page, 10, 20)).toEqual([10, 772]);
    expect(toPdfPoint({ ...page, rotate: 90, width: 792, height: 612 }, 10, 20)).toEqual([20, 10]);
    expect(toPdfPoint({ ...page, rotate: 180 }, 10, 20)).toEqual([602, 20]);
    expect(toPdfPoint({ ...page, rotate: 270, width: 792, height: 612 }, 10, 20)).toEqual([592, 782]);
  });

  it('fills text, enforces max length, checks boxes, adds dropdown options, draws overlays', async () => {
    const job: FillJob = {
      bytes: await makeForm(),
      pages: [page],
      acroFields,
      flatten: false,
      items: [
        { mapping: m('Name'), text: 'Zoë “Quotes” → Rivera' },
        { mapping: m('Short'), text: 'ABCDEFG' },
        { mapping: m('Agree', 'check'), checked: true },
        { mapping: m('Terms'), text: '3rd party' },
        { mapping: { ...m('x'), target: { kind: 'overlay', page: 0, rect: [300, 300, 150, 14] } }, text: 'Overlay text' },
      ],
    };
    const out = await PDFDocument.load(await fillPdf(job));
    const f = out.getForm();
    expect((f.getField('Name') as PDFTextField).getText()).toBe('Zoë “Quotes” ? Rivera');
    expect((f.getField('Short') as PDFTextField).getText()).toBe('ABCD');
    expect((f.getField('Agree') as PDFCheckBox).isChecked()).toBe(true);
    expect(f.getDropdown('Terms').getSelected()).toEqual(['3rd party']);
  });

  it('flattens and merges into a single clean document', async () => {
    const bytes = await makeForm();
    const job: FillJob = { bytes, pages: [page], acroFields, flatten: true, items: [{ mapping: m('Name'), text: 'Alex' }] };
    const merged = await PDFDocument.load(await fillAndMerge([job, job]));
    expect(merged.getPageCount()).toBe(2);
    expect(merged.getForm().getFields()).toHaveLength(0);
  });

  const realBol = 'Printable_Bill_of_Lading_BOL.pdf';
  it.skipIf(!existsSync(realBol))('fills a real-world BOL (112 fields, combos, checkboxes)', async () => {
    const bytes = new Uint8Array(readFileSync(realBol));
    const bol: AcroField[] = [
      { name: 'Shipper', kind: 'text', multiline: true, widgets: [{ page: 0, rect: [19, 133, 189, 60] }] },
      { name: 'Freight Terms', kind: 'dropdown', widgets: [{ page: 0, rect: [154, 107, 79, 14] }] },
      { name: 'HazCheck1', kind: 'checkbox', widgets: [{ page: 0, rect: [147, 284, 12, 12] }] },
      { name: 'Pcs TypeRow1.0', kind: 'dropdown', widgets: [{ page: 0, rect: [91, 280, 48, 20] }] },
    ];
    for (const flatten of [false, true]) {
      const out = await fillPdf({
        bytes,
        pages: [page],
        acroFields: bol,
        flatten,
        items: [
          { mapping: { ...m('Shipper'), style: { ...DEFAULT_STYLE, multiline: true } }, text: 'Acme Foods DC\n450 Industrial Pkwy' },
          { mapping: m('Freight Terms'), text: 'collect' },
          { mapping: m('HazCheck1', 'check'), checked: true },
          { mapping: m('Pcs TypeRow1.0'), text: 'PLT' },
        ],
      });
      const doc = await PDFDocument.load(out);
      if (!flatten) {
        const f = doc.getForm();
        expect(f.getTextField('Shipper').getText()).toBe('Acme Foods DC\n450 Industrial Pkwy');
        expect(f.getDropdown('Freight Terms').getSelected()).toEqual(['Collect']);
        expect(f.getCheckBox('HazCheck1').isChecked()).toBe(true);
      } else {
        expect(doc.getForm().getFields()).toHaveLength(0);
      }
    }
  });
});
