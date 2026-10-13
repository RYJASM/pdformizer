// Core data model for Autofill My PDF.
//
//   Form ──< Section ──< FieldDef           (the reusable data form / schema)
//   Form ──< FormSet                         (e.g. "Employer A · Truck 12": its own values + chosen PDFs)
//   Form ──< PdfDoc ──< Mapping              (a PDF template and how form fields land on it)
//
// Field values live in one of three places depending on the field's scope:
//   global → form.globalValues   (same everywhere: driver name, CDL, signature)
//   set    → set.values          (per employer / truck)
//   load   → set.loadValues      (changes every job; cleared by "New load")

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'phone'
  | 'email'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'signature';

export type Scope = 'global' | 'set' | 'load';

export type ConditionOp = 'equals' | 'notEquals' | 'contains' | 'isChecked' | 'isNotChecked' | 'isFilled' | 'isEmpty';

export interface Condition {
  field: string; // field key
  op: ConditionOp;
  value?: string;
}

export interface FieldDef {
  id: string;
  key: string; // stable token used in mappings: {driver_name}
  label: string;
  type: FieldType;
  scope: Scope;
  placeholder?: string;
  help?: string;
  options?: string[]; // select / radio
  required?: boolean;
  width?: 'full' | 'half' | 'third';
  showIf?: Condition;
  aliases?: string[]; // extra names used by auto-map ("B/L", "Bill of lading #")
  sample?: string; // value shown while designing mappings
  defaultValue?: string; // applied on "New load" for load-scope fields; may use {today}
}

export interface Section {
  id: string;
  title: string;
  description?: string;
  fields: FieldDef[];
  showIf?: Condition;
}

export type Values = Record<string, string>;

export interface Form {
  id: string;
  name: string;
  sections: Section[];
  globalValues: Values;
  isSample?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface FormSet {
  id: string;
  formId: string;
  name: string;
  color: string;
  values: Values;
  loadValues: Values;
  docIds: string[];
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

/** A rectangle in page "display space" at scale 1: origin top-left, units = PDF points, page rotation applied. */
export type Rect = [x: number, y: number, w: number, h: number];

export interface DocPage {
  width: number; // displayed width at scale 1 (after rotation)
  height: number;
  rotate: number; // 0 | 90 | 180 | 270
  view: [number, number, number, number]; // PDF view box (x0, y0, x1, y1)
}

export type AcroKind = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list' | 'signature' | 'button';

export interface AcroWidget {
  page: number; // 0-based
  rect: Rect; // display space
  exportValue?: string; // checkbox on-value / radio option
}

export interface AcroField {
  name: string; // fully-qualified field name
  kind: AcroKind;
  label?: string; // tooltip /TU if any
  widgets: AcroWidget[];
  options?: string[];
  multiline?: boolean;
  maxLen?: number;
  readOnly?: boolean;
  hasValue?: boolean; // the blank PDF already shows something in this field
  align?: Align; // the field's own quadding
}

export type RenderMode = 'text' | 'check' | 'image';
export type FontName = 'helvetica' | 'helvetica-bold' | 'times' | 'courier';
export type Align = 'left' | 'center' | 'right';

export interface TextStyle {
  font: FontName;
  size: number; // 0 = auto-fit
  align: Align;
  color: string; // hex
  multiline: boolean;
  uppercase?: boolean;
  checkMark?: 'x' | 'check' | 'dot';
}

export interface CheckRule {
  op: 'truthy' | 'equals' | 'notEquals' | 'contains';
  value?: string;
}

export type MappingTarget =
  | { kind: 'acro'; field: string }
  | { kind: 'overlay'; page: number; rect: Rect };

export interface Mapping {
  id: string;
  target: MappingTarget;
  /** Template: "{driver_name}" or "{shipper_city}, {shipper_state}". Filters: {pickup_date|date:MM/DD/YY} */
  source: string;
  render: RenderMode;
  check?: CheckRule;
  style: TextStyle;
}

export interface PdfDoc {
  id: string;
  formId: string;
  name: string;
  fileId: string; // key into the binary file store
  fileName: string;
  fileSize: number;
  pages: DocPage[];
  acroFields: AcroField[];
  mappings: Mapping[];
  outputName: string; // template for saved file names
  createdAt: number;
  updatedAt: number;
}

export interface HistoryEntry {
  id: string;
  formId: string;
  setId: string;
  label: string;
  loadValues: Values;
  createdAt: number;
}

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  activeFormId?: string;
  activeSetId?: string;
  flattenOnSave: boolean;
  downloadFolder: string; // subfolder in Downloads, may use templates
  showLinks: boolean;
  seenSample?: boolean;
}

export interface Workspace {
  version: 1;
  forms: Form[];
  sets: FormSet[];
  docs: PdfDoc[];
  history: HistoryEntry[];
  settings: Settings;
}

export const DEFAULT_STYLE: TextStyle = {
  font: 'helvetica',
  size: 0,
  align: 'left',
  color: '#111111',
  multiline: false,
  checkMark: 'x',
};

export const SET_COLORS = ['#5b5bd6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6', '#64748b'];
