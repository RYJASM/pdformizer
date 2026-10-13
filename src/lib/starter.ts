// Starter form templates offered by the setup wizard.
import type { FieldDef, FieldType, Form, Scope, Section } from './types';
import { uid } from './util';

type Extra = Partial<Omit<FieldDef, 'id' | 'key' | 'label' | 'type' | 'scope'>>;
const f = (key: string, label: string, type: FieldType, scope: Scope, extra: Extra = {}): FieldDef => ({
  id: uid('f'),
  key,
  label,
  type,
  scope,
  ...extra,
});
const sec = (title: string, description: string, fields: FieldDef[], id = uid('s')): Section => ({ id, title, description, fields });

export interface StarterBlock {
  id: string;
  title: string;
  description: string;
  icon: string;
  recommended: boolean;
  build: () => Section;
}

export const TRUCKING_BLOCKS: StarterBlock[] = [
  {
    id: 'driver',
    title: 'Driver',
    description: 'Name, phone, CDL, signature — shared by every set',
    icon: 'user',
    recommended: true,
    build: () =>
      sec('Driver', 'Same on every form, for every employer.', [
        f('driver_name', 'Full name', 'text', 'global', { width: 'half', sample: 'Alex Rivera', aliases: ['driver', 'driver name', 'print name', 'printed name', 'name'] }),
        f('driver_phone', 'Phone', 'phone', 'global', { width: 'half', sample: '(555) 214-8890', aliases: ['driver phone', 'cell'] }),
        f('driver_email', 'Email', 'email', 'global', { width: 'half', sample: 'alex@example.com' }),
        f('cdl_number', 'CDL number', 'text', 'global', { width: 'third', sample: 'R123-4567-8901', aliases: ['cdl', 'license number', 'drivers license', 'dl number'] }),
        f('cdl_state', 'CDL state', 'text', 'global', { width: 'third', sample: 'TX', aliases: ['license state'] }),
        f('driver_signature', 'Signature', 'signature', 'global', { aliases: ['driver signature', 'signature driver', 'authorized signature driver', 'carrier signature', 'signature'] }),
      ]),
  },
  {
    id: 'carrier',
    title: 'Carrier / employer',
    description: 'Company, MC & DOT numbers, dispatch',
    icon: 'building',
    recommended: true,
    build: () =>
      sec('Carrier', 'Who you are hauling for. Each set can have its own.', [
        f('driver_type', 'I drive as', 'radio', 'set', { options: ['Company driver', 'Owner-operator', 'Lease operator'], sample: 'Owner-operator' }),
        f('carrier_name', 'Carrier / company name', 'text', 'set', { sample: 'Rivera Freight LLC', aliases: ['carrier', 'carrier name', 'company', 'company name', 'motor carrier', 'trucking company'] }),
        f('leased_to', 'Leased on to', 'text', 'set', { sample: 'Northline Transport', showIf: { field: 'driver_type', op: 'equals', value: 'Lease operator' } }),
        f('mc_number', 'MC #', 'text', 'set', { width: 'half', sample: 'MC-123456', aliases: ['mc', 'mc number', 'docket number'] }),
        f('dot_number', 'USDOT #', 'text', 'set', { width: 'half', sample: '3456789', aliases: ['dot', 'us dot', 'dot number', 'usdot number'] }),
        f('tax_id', 'EIN / Tax ID', 'text', 'set', { width: 'half', sample: '12-3456789', aliases: ['ein', 'tax id', 'fein'], showIf: { field: 'driver_type', op: 'equals', value: 'Owner-operator' } }),
        f('carrier_address', 'Address', 'textarea', 'set', { sample: '1200 Commerce St\nDallas, TX 75201', aliases: ['carrier address', 'company address', 'remit to'] }),
        f('dispatch_name', 'Dispatcher', 'text', 'set', { width: 'half', sample: 'Jordan Lee', aliases: ['dispatcher', 'dispatch contact'] }),
        f('dispatch_phone', 'Dispatch phone', 'phone', 'set', { width: 'half', sample: '(555) 300-1200', aliases: ['dispatch phone', 'carrier phone', 'company phone'] }),
      ]),
  },
  {
    id: 'equipment',
    title: 'Truck & trailer',
    description: 'Unit numbers, plates, VIN, trailer type',
    icon: 'truck',
    recommended: true,
    build: () =>
      sec('Truck & trailer', 'Your equipment for this set.', [
        f('truck_number', 'Truck / unit #', 'text', 'set', { width: 'third', sample: '412', aliases: ['truck', 'tractor', 'unit', 'truck number', 'tractor number', 'power unit'] }),
        f('truck_plate', 'Truck plate', 'text', 'set', { width: 'third', sample: 'TX 9KL-221', aliases: ['tractor plate', 'truck license plate'] }),
        f('truck_vin', 'Truck VIN', 'text', 'set', { width: 'third', sample: '1XKYD49X0LJ123456', aliases: ['vin', 'tractor vin'] }),
        f('trailer_type', 'Trailer type', 'select', 'set', { width: 'third', options: ['Dry van', 'Reefer', 'Flatbed', 'Step deck', 'Tanker', 'Conestoga', 'Power only'], sample: 'Dry van', aliases: ['equipment type', 'equipment'] }),
        f('trailer_number', 'Trailer #', 'text', 'set', { width: 'third', sample: '53-2287', aliases: ['trailer', 'trailer number', 'trailer no'] }),
        f('trailer_plate', 'Trailer plate', 'text', 'set', { width: 'third', sample: 'TX 44T-901', aliases: ['trailer license plate'] }),
      ]),
  },
  {
    id: 'load',
    title: 'This load',
    description: 'Load/BOL/PO numbers, dates, shipper, consignee, freight',
    icon: 'package',
    recommended: true,
    build: () =>
      sec('This load', 'Changes every trip. "New load" clears these.', [
        f('load_number', 'Load #', 'text', 'load', { width: 'third', sample: 'L-58213', aliases: ['load', 'load number', 'load no', 'trip number', 'order number'] }),
        f('bol_number', 'BOL #', 'text', 'load', { width: 'third', sample: 'BOL-77120', aliases: ['bol', 'b/l', 'bill of lading number', 'bl number', 'bl'] }),
        f('po_number', 'PO #', 'text', 'load', { width: 'third', sample: 'PO-4410', aliases: ['po', 'p/o', 'purchase order', 'po number'] }),
        f('pickup_date', 'Pickup date', 'date', 'load', { width: 'half', defaultValue: '{today}', aliases: ['ship date', 'pick up date', 'date shipped', 'pickup date'] }),
        f('delivery_date', 'Delivery date', 'date', 'load', { width: 'half', aliases: ['required delivery date', 'delivery date', 'due date', 'deliver by'] }),
        f('shipper_name', 'Shipper', 'text', 'load', { width: 'half', sample: 'Acme Foods DC', aliases: ['shipper', 'ship from', 'shipper name', 'origin'] }),
        f('consignee_name', 'Consignee', 'text', 'load', { width: 'half', sample: 'Fresh Mart #118', aliases: ['consignee', 'ship to', 'receiver', 'consignee name'] }),
        f('shipper_address', 'Shipper address', 'textarea', 'load', { width: 'half', sample: '450 Industrial Pkwy\nMemphis, TN 38118', aliases: ['shipper address', 'origin address', 'pickup address'] }),
        f('consignee_address', 'Consignee address', 'textarea', 'load', { width: 'half', sample: '88 Market Rd\nAtlanta, GA 30318', aliases: ['consignee address', 'delivery address', 'destination address'] }),
        f('commodity', 'Commodity', 'text', 'load', { sample: 'Canned goods, palletized', aliases: ['description', 'commodity', 'description of articles', 'freight description'] }),
        f('pieces', 'Pieces / pallets', 'number', 'load', { width: 'third', sample: '22', aliases: ['pieces', 'pcs', 'handling units', 'hu', 'pallets', 'total hu'] }),
        f('weight', 'Weight (lbs)', 'number', 'load', { width: 'third', sample: '38500', aliases: ['weight', 'total weight', 'gross weight', 'weight lbs'] }),
        f('seal_number', 'Seal #', 'text', 'load', { width: 'third', sample: 'SL-90211', aliases: ['seal', 'seal number'] }),
        f('freight_terms', 'Freight terms', 'select', 'load', { width: 'half', options: ['Prepaid', 'Collect', '3rd party'], defaultValue: 'Prepaid', sample: 'Prepaid', aliases: ['terms', 'freight terms', 'freight charges'] }),
        f('rate', 'Rate ($)', 'number', 'load', { width: 'half', sample: '2450', aliases: ['rate', 'line haul', 'linehaul', 'total rate', 'carrier pay'] }),
        f('hazmat', 'Hazardous materials', 'checkbox', 'load', { sample: '', aliases: ['hazmat', 'hm', 'haz', 'hazardous'] }),
        f('un_number', 'UN #', 'text', 'load', { width: 'half', sample: 'UN1203', aliases: ['un number', 'un na'], showIf: { field: 'hazmat', op: 'isChecked' } }),
        f('hazmat_contact', 'Emergency contact', 'phone', 'load', { width: 'half', sample: '(800) 424-9300', aliases: ['hazmat contact', 'emergency contact', 'hazardous materials emergency contact', 'emergency phone'], showIf: { field: 'hazmat', op: 'isChecked' } }),
        f('notes', 'Special instructions', 'textarea', 'load', { sample: 'Driver assist unload. Call 1 hr before arrival.', aliases: ['special instructions', 'notes', 'remarks', 'comments', 'instructions'] }),
        f('signed_date', 'Signature date', 'date', 'load', { width: 'half', defaultValue: '{today}', aliases: ['signature date', 'date signed', 'signed date'] }),
      ]),
  },
  {
    id: 'reefer',
    title: 'Reefer details',
    description: 'Temp set point & pulp temps (shows only for reefer)',
    icon: 'thermometer',
    recommended: false,
    build: () => {
      const s = sec('Reefer', 'Shown only when trailer type is Reefer.', [
        f('reefer_temp', 'Set point (°F)', 'number', 'load', { width: 'half', sample: '34', aliases: ['temperature', 'temp', 'set point', 'reefer temp'] }),
        f('pulp_temp', 'Pulp temp at pickup (°F)', 'number', 'load', { width: 'half', sample: '35', aliases: ['pulp temp', 'product temp'] }),
        f('reefer_mode', 'Mode', 'select', 'load', { width: 'half', options: ['Continuous', 'Cycle (start/stop)'], sample: 'Continuous' }),
      ]);
      s.showIf = { field: 'trailer_type', op: 'equals', value: 'Reefer' };
      return s;
    },
  },
  {
    id: 'detention',
    title: 'Detention & lumper',
    description: 'In/out times, lumper receipt amount',
    icon: 'clock',
    recommended: false,
    build: () =>
      sec('Detention & lumper', 'Times at shipper/receiver and unload fees.', [
        f('arrival_time', 'Arrived', 'text', 'load', { width: 'third', placeholder: '08:15', sample: '08:15', aliases: ['time in', 'arrival time', 'in time'] }),
        f('departure_time', 'Departed', 'text', 'load', { width: 'third', placeholder: '12:40', sample: '12:40', aliases: ['time out', 'departure time', 'out time'] }),
        f('lumper_fee', 'Lumper fee ($)', 'number', 'load', { width: 'third', sample: '185', aliases: ['lumper', 'lumper amount', 'unload fee'] }),
      ]),
  },
];

export function buildTruckingForm(name: string, blockIds: string[]): Form {
  const now = Date.now();
  return {
    id: uid('form'),
    name,
    sections: TRUCKING_BLOCKS.filter((b) => blockIds.includes(b.id)).map((b) => b.build()),
    globalValues: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function buildBlankForm(name: string): Form {
  const now = Date.now();
  return {
    id: uid('form'),
    name,
    sections: [
      sec('My info', 'Fields you fill once.', [
        f('full_name', 'Full name', 'text', 'global', { aliases: ['name'] }),
        f('signature', 'Signature', 'signature', 'global'),
      ]),
      sec('This job', 'Fields that change every time.', [f('date', 'Date', 'date', 'load', { defaultValue: '{today}' })]),
    ],
    globalValues: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function newField(type: FieldType, label: string, key: string, scope: Scope = 'set'): FieldDef {
  return f(key, label, type, scope, type === 'select' || type === 'radio' ? { options: ['Option 1', 'Option 2'] } : {});
}

export function newSection(title = 'New section'): Section {
  return sec(title, '', []);
}
