// Builds the "Explore the sample" workspace: a trucking form, two sets, and two generated PDFs —
// a fillable Bill of Lading (AcroForm fields) and a flat Trip Sheet (overlay text boxes).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Form, FormSet, Mapping, PdfDoc, Rect, TextStyle } from './types';
import { DEFAULT_STYLE } from './types';
import { buildTruckingForm } from './starter';
import { putFile } from './db';
import { openPdf, analyzePdf, closePdf } from './pdf/pdfjs';
import { todayIso } from './template';
import { uid } from './util';
import { sampleSignature } from './sampleSignature';

const W = 612;
const H = 792;
const INK = rgb(0.13, 0.15, 0.2);
const LINE = rgb(0.55, 0.58, 0.64);
const ACCENT = rgb(0.36, 0.36, 0.84);

// display rect (top-left origin) → pdf-lib rect (bottom-left origin)
const pr = (r: Rect) => ({ x: r[0], y: H - r[1] - r[3], width: r[2], height: r[3] });

function label(page: PDFPage, font: PDFFont, text: string, x: number, yTop: number, size = 7) {
  page.drawText(text.toUpperCase(), { x, y: H - yTop - size, size, font, color: rgb(0.42, 0.45, 0.52) });
}

function box(page: PDFPage, r: Rect, fill = false) {
  page.drawRectangle({ ...pr(r), borderColor: LINE, borderWidth: 0.75, color: fill ? rgb(0.965, 0.968, 0.985) : undefined });
}

// ---------------- Bill of Lading (fillable) ----------------
const BOL_FIELDS: Record<string, Rect> = {
  'Ship Date': [400, 92, 90, 18],
  'BOL Number': [496, 92, 92, 18],
  'Load Number': [400, 128, 90, 18],
  'PO Number': [496, 128, 92, 18],
  'Ship From': [30, 186, 268, 70],
  'Ship To': [314, 186, 268, 70],
  'Carrier Name': [30, 284, 200, 18],
  'MC Number': [238, 284, 80, 18],
  'DOT Number': [326, 284, 80, 18],
  'Trailer Number': [414, 284, 80, 18],
  'Seal Number': [502, 284, 80, 18],
  'Pieces 1': [30, 364, 56, 20],
  'Description 1': [118, 364, 330, 20],
  'Weight 1': [456, 364, 126, 20],
  'Pieces 2': [30, 388, 56, 20],
  'Description 2': [118, 388, 330, 20],
  'Weight 2': [456, 388, 126, 20],
  'Special Instructions': [30, 452, 552, 52],
  'Emergency Contact': [30, 532, 270, 18],
  'Driver Signature': [314, 640, 180, 36],
  'Signature Date': [502, 640, 80, 36],
  'Driver Printed Name': [314, 700, 268, 18],
  'Shipper Signature': [30, 640, 270, 36],
};
const BOL_CHECKS: Record<string, Rect> = {
  'Terms Prepaid': [34, 138, 10, 10],
  'Terms Collect': [104, 138, 10, 10],
  'Terms Third Party': [172, 138, 10, 10],
  'HM 1': [95, 369, 10, 10],
  'HM 2': [95, 393, 10, 10],
};

async function buildBol(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Sample Bill of Lading');
  const page = pdf.addPage([W, H]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: ACCENT });
  page.drawText('STRAIGHT BILL OF LADING', { x: 30, y: H - 52, size: 18, font: bold, color: INK });
  page.drawText('Short form · Not negotiable · SAMPLE DOCUMENT', { x: 30, y: H - 66, size: 8, font, color: rgb(0.42, 0.45, 0.52) });
  label(page, font, 'Freight terms', 30, 124);
  page.drawText('Prepaid', { x: 48, y: H - 147, size: 8, font, color: INK });
  page.drawText('Collect', { x: 118, y: H - 147, size: 8, font, color: INK });
  page.drawText('3rd party', { x: 186, y: H - 147, size: 8, font, color: INK });

  label(page, font, 'Ship date', 400, 82);
  label(page, font, 'BOL #', 496, 82);
  label(page, font, 'Load #', 400, 118);
  label(page, font, 'PO #', 496, 118);

  page.drawRectangle({ x: 30, y: H - 176, width: 268, height: 16, color: rgb(0.93, 0.93, 0.98) });
  page.drawText('SHIP FROM (SHIPPER)', { x: 36, y: H - 171, size: 8, font: bold, color: INK });
  page.drawRectangle({ x: 314, y: H - 176, width: 268, height: 16, color: rgb(0.93, 0.93, 0.98) });
  page.drawText('SHIP TO (CONSIGNEE)', { x: 320, y: H - 171, size: 8, font: bold, color: INK });

  label(page, font, 'Carrier', 30, 274);
  label(page, font, 'MC #', 238, 274);
  label(page, font, 'USDOT #', 326, 274);
  label(page, font, 'Trailer #', 414, 274);
  label(page, font, 'Seal #', 502, 274);

  // commodity table
  page.drawRectangle({ x: 30, y: H - 360, width: 552, height: 18, color: rgb(0.93, 0.93, 0.98) });
  page.drawText('PCS', { x: 36, y: H - 354, size: 8, font: bold, color: INK });
  page.drawText('HM', { x: 93, y: H - 354, size: 8, font: bold, color: INK });
  page.drawText('DESCRIPTION OF ARTICLES', { x: 124, y: H - 354, size: 8, font: bold, color: INK });
  page.drawText('WEIGHT (LBS)', { x: 462, y: H - 354, size: 8, font: bold, color: INK });
  for (let i = 0; i < 3; i++) box(page, [30, 362 + i * 24, 552, 24]);
  page.drawText('TOTAL', { x: 400, y: H - 434, size: 8, font: bold, color: INK });

  label(page, font, 'Special instructions', 30, 442);
  label(page, font, 'Hazmat emergency contact', 30, 522);

  page.drawText(
    'RECEIVED, subject to the classifications and tariffs in effect on the date of issue of this Bill of Lading, the property described above in apparent good order.',
    { x: 30, y: H - 580, size: 6.5, font, color: rgb(0.42, 0.45, 0.52), maxWidth: 552, lineHeight: 9 },
  );

  label(page, font, 'Shipper signature', 30, 630);
  label(page, font, 'Driver signature', 314, 630);
  label(page, font, 'Date', 502, 630);
  label(page, font, 'Driver printed name', 314, 690);
  page.drawLine({ start: { x: 30, y: H - 677 }, end: { x: 300, y: H - 677 }, thickness: 0.75, color: LINE });
  page.drawLine({ start: { x: 314, y: H - 677 }, end: { x: 494, y: H - 677 }, thickness: 0.75, color: LINE });
  page.drawLine({ start: { x: 502, y: H - 677 }, end: { x: 582, y: H - 677 }, thickness: 0.75, color: LINE });

  const form = pdf.getForm();
  for (const [name, r] of Object.entries(BOL_FIELDS)) {
    const tf = form.createTextField(name);
    if (['Ship From', 'Ship To', 'Special Instructions'].includes(name)) tf.enableMultiline();
    const lined = ['Driver Signature', 'Signature Date', 'Shipper Signature'].includes(name);
    tf.addToPage(page, { ...pr(r), font, borderWidth: lined ? 0 : 0.75, borderColor: lined ? undefined : LINE, backgroundColor: lined ? undefined : rgb(0.985, 0.985, 1) });
    tf.setFontSize(0);
  }
  for (const [name, r] of Object.entries(BOL_CHECKS)) {
    const cb = form.createCheckBox(name);
    cb.addToPage(page, { ...pr(r), borderWidth: 0.75, borderColor: INK, backgroundColor: rgb(1, 1, 1) });
  }
  return pdf.save();
}

// ---------------- Trip sheet (flat — no fillable fields) ----------------
const TRIP: Record<string, Rect> = {
  driver: [120, 104, 200, 16],
  date: [430, 104, 150, 16],
  carrier: [120, 132, 200, 16],
  truck: [430, 132, 60, 16],
  trailer: [520, 132, 60, 16],
  load: [120, 160, 200, 16],
  bol: [430, 160, 150, 16],
  shipper: [44, 232, 250, 44],
  consignee: [326, 232, 250, 44],
  pu_date: [92, 300, 100, 16],
  del_date: [374, 300, 100, 16],
  commodity: [120, 352, 460, 16],
  weight: [120, 380, 120, 16],
  pieces: [330, 380, 80, 16],
  reefer: [500, 380, 80, 16],
  notes: [44, 450, 536, 60],
  sig: [44, 560, 220, 40],
  sig_date: [330, 580, 120, 16],
  sig_name: [44, 616, 220, 16],
};

async function buildTrip(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Sample Trip Sheet');
  const page = pdf.addPage([W, H]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText('DRIVER TRIP SHEET', { x: 30, y: H - 56, size: 18, font: bold, color: INK });
  page.drawText('Sample flat form — no fillable fields. Text is placed on top of the lines.', { x: 30, y: H - 72, size: 8, font, color: rgb(0.42, 0.45, 0.52) });
  page.drawRectangle({ x: 30, y: H - 82, width: 552, height: 1.5, color: ACCENT });

  const lineField = (lbl: string, r: Rect, lx: number) => {
    page.drawText(lbl, { x: lx, y: H - r[1] - r[3] + 4, size: 9, font: bold, color: INK });
    page.drawLine({ start: { x: r[0], y: H - r[1] - r[3] }, end: { x: r[0] + r[2], y: H - r[1] - r[3] }, thickness: 0.6, color: LINE });
  };
  lineField('Driver', TRIP.driver, 30);
  lineField('Date', TRIP.date, 340);
  lineField('Carrier', TRIP.carrier, 30);
  lineField('Truck', TRIP.truck, 340);
  lineField('Trl', TRIP.trailer, 498);
  lineField('Load #', TRIP.load, 30);
  lineField('BOL #', TRIP.bol, 340);

  page.drawText('PICKUP', { x: 30, y: H - 216, size: 10, font: bold, color: ACCENT });
  page.drawText('DELIVERY', { x: 312, y: H - 216, size: 10, font: bold, color: ACCENT });
  box(page, [30, 224, 270, 60]);
  box(page, [312, 224, 270, 60]);
  lineField('Date', TRIP.pu_date, 44);
  lineField('Date', TRIP.del_date, 326);

  page.drawText('FREIGHT', { x: 30, y: H - 336, size: 10, font: bold, color: ACCENT });
  lineField('Commodity', TRIP.commodity, 30);
  lineField('Weight', TRIP.weight, 30);
  lineField('Pieces', TRIP.pieces, 260);
  lineField('Temp °F', TRIP.reefer, 440);

  page.drawText('NOTES', { x: 30, y: H - 434, size: 10, font: bold, color: ACCENT });
  box(page, [30, 442, 552, 76]);
  for (let i = 1; i < 4; i++) page.drawLine({ start: { x: 40, y: H - 442 - i * 19 }, end: { x: 572, y: H - 442 - i * 19 }, thickness: 0.4, color: rgb(0.85, 0.86, 0.9) });

  page.drawLine({ start: { x: 44, y: H - 600 }, end: { x: 264, y: H - 600 }, thickness: 0.75, color: INK });
  page.drawText('Driver signature', { x: 44, y: H - 610, size: 7, font, color: rgb(0.42, 0.45, 0.52) });
  lineField('Date', TRIP.sig_date, 300);
  page.drawLine({ start: { x: 44, y: H - 632 }, end: { x: 264, y: H - 632 }, thickness: 0.6, color: LINE });
  page.drawText('Printed name', { x: 44, y: H - 642, size: 7, font, color: rgb(0.42, 0.45, 0.52) });
  return pdf.save();
}

// ---------------- workspace assembly ----------------
const st = (patch: Partial<TextStyle> = {}): TextStyle => ({ ...DEFAULT_STYLE, ...patch });
const acro = (field: string, source: string, patch: Partial<Mapping> = {}): Mapping => ({
  id: uid('m'),
  target: { kind: 'acro', field },
  source,
  render: 'text',
  style: st(),
  ...patch,
});
const over = (rect: Rect, source: string, patch: Partial<Mapping> = {}): Mapping => ({
  id: uid('m'),
  target: { kind: 'overlay', page: 0, rect },
  source,
  render: 'text',
  style: st({ size: 10 }),
  ...patch,
});

async function makeDoc(form: Form, name: string, bytes: Uint8Array, mappings: Mapping[], outputName: string): Promise<PdfDoc> {
  const fileId = uid('file');
  await putFile(fileId, bytes);
  const pdf = await openPdf(bytes);
  const { pages, acroFields } = await analyzePdf(pdf);
  closePdf(pdf);
  return {
    id: uid('doc'),
    formId: form.id,
    name,
    fileId,
    fileName: name.toLowerCase().replace(/\s+/g, '-') + '.pdf',
    fileSize: bytes.byteLength,
    pages,
    acroFields,
    mappings,
    outputName,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function buildSampleWorkspace(): Promise<{ form: Form; sets: FormSet[]; docs: PdfDoc[] }> {
  const form = buildTruckingForm('Sample · Trucking packet', ['driver', 'carrier', 'equipment', 'load', 'reefer']);
  form.isSample = true;
  form.globalValues = {
    driver_name: 'Alex Rivera',
    driver_phone: '(555) 214-8890',
    driver_email: 'alex.rivera@example.com',
    cdl_number: 'R123-4567-8901',
    cdl_state: 'TX',
    driver_signature: sampleSignature(),
  };
  const today = todayIso();
  const plus = (d: number) => todayIso(new Date(Date.now() + d * 86400000));

  const bol = await makeDoc(
    form,
    'Bill of Lading',
    await buildBol(),
    [
      acro('Ship Date', '{pickup_date}'),
      acro('BOL Number', '{bol_number}'),
      acro('Load Number', '{load_number}'),
      acro('PO Number', '{po_number}'),
      acro('Ship From', '{shipper_name}\n{shipper_address}', { style: st({ multiline: true }) }),
      acro('Ship To', '{consignee_name}\n{consignee_address}', { style: st({ multiline: true }) }),
      acro('Carrier Name', '{carrier_name}'),
      acro('MC Number', '{mc_number}'),
      acro('DOT Number', '{dot_number}'),
      acro('Trailer Number', '{trailer_number}'),
      acro('Seal Number', '{seal_number}'),
      acro('Pieces 1', '{pieces}', { style: st({ align: 'center' }) }),
      acro('Description 1', '{commodity}'),
      acro('Weight 1', '{weight|number}', { style: st({ align: 'right' }) }),
      acro('HM 1', '{hazmat}', { render: 'check' }),
      acro('Terms Prepaid', '{freight_terms}', { render: 'check', check: { op: 'equals', value: 'Prepaid' } }),
      acro('Terms Collect', '{freight_terms}', { render: 'check', check: { op: 'equals', value: 'Collect' } }),
      acro('Terms Third Party', '{freight_terms}', { render: 'check', check: { op: 'equals', value: '3rd party' } }),
      acro('Special Instructions', '{notes}', { style: st({ multiline: true }) }),
      acro('Emergency Contact', '{hazmat_contact}'),
      acro('Driver Signature', '{driver_signature}', { render: 'image', style: st({ align: 'left' }) }),
      acro('Signature Date', '{signed_date}', { style: st({ align: 'center' }) }),
      acro('Driver Printed Name', '{driver_name}'),
    ],
    'BOL {bol_number} {pickup_date|date:MM-DD-YY}',
  );

  const trip = await makeDoc(
    form,
    'Trip Sheet',
    await buildTrip(),
    [
      over(TRIP.driver, '{driver_name}'),
      over(TRIP.date, '{pickup_date|date:ddd MMM D, YYYY}'),
      over(TRIP.carrier, '{carrier_name}'),
      over(TRIP.truck, '{truck_number}', { style: st({ size: 10, align: 'center' }) }),
      over(TRIP.trailer, '{trailer_number}', { style: st({ size: 10, align: 'center' }) }),
      over(TRIP.load, '{load_number}', { style: st({ size: 10, font: 'helvetica-bold' }) }),
      over(TRIP.bol, '{bol_number}'),
      over(TRIP.shipper, '{shipper_name}\n{shipper_address}', { style: st({ size: 10, multiline: true }) }),
      over(TRIP.consignee, '{consignee_name}\n{consignee_address}', { style: st({ size: 10, multiline: true }) }),
      over(TRIP.pu_date, '{pickup_date}'),
      over(TRIP.del_date, '{delivery_date}'),
      over(TRIP.commodity, '{commodity}'),
      over(TRIP.weight, '{weight|number} lbs'),
      over(TRIP.pieces, '{pieces}', { style: st({ size: 10, align: 'center' }) }),
      over(TRIP.reefer, '{reefer_temp}', { style: st({ size: 10, align: 'center' }) }),
      over(TRIP.notes, '{notes}', { style: st({ size: 11, multiline: true, color: '#1d3fae' }) }),
      over(TRIP.sig, '{driver_signature}', { render: 'image', style: st({ align: 'left' }) }),
      over(TRIP.sig_date, '{signed_date}'),
      over(TRIP.sig_name, '{driver_name|upper}'),
    ],
    'Trip sheet {load_number}',
  );

  const now = Date.now();
  const sets: FormSet[] = [
    {
      id: uid('set'),
      formId: form.id,
      name: 'Rivera Freight · Truck 412',
      color: '#5b5bd6',
      values: {
        driver_type: 'Owner-operator',
        carrier_name: 'Rivera Freight LLC',
        mc_number: 'MC-123456',
        dot_number: '3456789',
        tax_id: '12-3456789',
        carrier_address: '1200 Commerce St\nDallas, TX 75201',
        dispatch_name: 'Jordan Lee',
        dispatch_phone: '(555) 300-1200',
        truck_number: '412',
        truck_plate: 'TX 9KL-221',
        truck_vin: '1XKYD49X0LJ123456',
        trailer_type: 'Dry van',
        trailer_number: '53-2287',
        trailer_plate: 'TX 44T-901',
      },
      loadValues: {
        load_number: 'L-58213',
        bol_number: 'BOL-77120',
        po_number: 'PO-4410',
        pickup_date: today,
        delivery_date: plus(2),
        shipper_name: 'Acme Foods DC',
        shipper_address: '450 Industrial Pkwy\nMemphis, TN 38118',
        consignee_name: 'Fresh Mart #118',
        consignee_address: '88 Market Rd\nAtlanta, GA 30318',
        commodity: 'Canned goods, palletized (22 PLT)',
        pieces: '22',
        weight: '38500',
        seal_number: 'SL-90211',
        freight_terms: 'Prepaid',
        rate: '2450',
        notes: 'Driver assist unload. Call receiver 1 hr before arrival: (555) 410-7788.',
        signed_date: today,
      },
      docIds: [bol.id, trip.id],
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now,
    },
    {
      id: uid('set'),
      formId: form.id,
      name: 'Northline Transport · Truck 77',
      color: '#10b981',
      values: {
        driver_type: 'Lease operator',
        carrier_name: 'Northline Transport Inc.',
        leased_to: 'Northline Transport Inc.',
        mc_number: 'MC-765432',
        dot_number: '1122334',
        carrier_address: '77 Harbor Way\nSavannah, GA 31401',
        dispatch_name: 'Sam Patel',
        dispatch_phone: '(555) 800-7700',
        truck_number: '77',
        truck_plate: 'GA RT-7710',
        trailer_type: 'Reefer',
        trailer_number: 'R-5310',
      },
      loadValues: {
        load_number: 'NL-20931',
        bol_number: '8840021',
        pickup_date: today,
        delivery_date: plus(1),
        shipper_name: 'Sunrise Produce Co.',
        shipper_address: '12 Grower Ln\nPlant City, FL 33563',
        consignee_name: 'Coastal Grocers DC',
        consignee_address: '900 Distribution Dr\nCharlotte, NC 28206',
        commodity: 'Fresh strawberries',
        pieces: '20',
        weight: '36200',
        freight_terms: 'Collect',
        reefer_temp: '34',
        pulp_temp: '35',
        reefer_mode: 'Continuous',
        signed_date: today,
      },
      docIds: [bol.id, trip.id],
      createdAt: now,
      updatedAt: now - 1000,
    },
  ];
  return { form, sets, docs: [bol, trip] };
}
