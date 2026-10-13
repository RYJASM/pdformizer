import { create } from 'zustand';
import type { Form, FormSet, HistoryEntry, PdfDoc, Scope, Section, Settings, Values, Workspace } from './types';
import { SET_COLORS } from './types';
import { deleteFile, kvGet, kvSet } from './db';
import { allFields, loadDefaults } from './values';
import { renameToken } from './template';
import { debounce, uid } from './util';
import { forgetPdf } from './pdf/pdfjs';

const KEY = 'workspace';

export const emptyWorkspace = (): Workspace => ({
  version: 1,
  forms: [],
  sets: [],
  docs: [],
  history: [],
  settings: { theme: 'system', flattenOnSave: false, downloadFolder: 'Autofill My PDF', showLinks: true },
});

interface State extends Workspace {
  ready: boolean;
  saving: boolean;
  storageError: string | null;
  init(): Promise<void>;
  replaceWorkspace(ws: Workspace): void;

  setSettings(patch: Partial<Settings>): void;

  addForm(form: Form): void;
  updateForm(id: string, fn: (f: Form) => Form): void;
  updateSections(formId: string, fn: (s: Section[]) => Section[]): void;
  renameFieldKey(formId: string, from: string, to: string): void;
  changeFieldScope(formId: string, key: string, scope: Scope): void;
  deleteForm(id: string): void;

  setValue(formId: string, setId: string | undefined, key: string, value: string): void;
  setValues(formId: string, setId: string | undefined, values: Values): void;

  addSet(formId: string, name: string, color?: string, copyFrom?: string): FormSet;
  insertSets(sets: FormSet[]): void;
  updateSet(id: string, patch: Partial<FormSet>): void;
  deleteSet(id: string): void;
  touchSet(id: string): void;

  addDoc(doc: PdfDoc, setIds?: string[]): void;
  updateDoc(id: string, fn: (d: PdfDoc) => PdfDoc): void;
  deleteDoc(id: string): void;

  newLoad(setId: string, label?: string): void;
  restoreHistory(entryId: string): void;
  deleteHistory(entryId: string): void;
}

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('autofill-my-pdf') : null;
const tabId = uid('tab');

function pick(s: State): Workspace {
  return { version: 1, forms: s.forms, sets: s.sets, docs: s.docs, history: s.history, settings: s.settings };
}

const persist = debounce(async (ws: Workspace) => {
  try {
    await kvSet(KEY, ws);
    channel?.postMessage({ type: 'changed', from: tabId });
    useStore.setState({ saving: false, storageError: null });
  } catch (e) {
    console.error('[autofill] save failed', e);
    useStore.setState({ saving: false, storageError: e instanceof Error ? e.message : String(e) });
  }
}, 350);

export const useStore = create<State>((set, get) => {
  // every mutating action goes through this so persistence is automatic
  const mutate = (fn: (s: State) => Partial<Workspace>) => {
    set((s) => ({ ...fn(s), saving: true }));
    persist(pick(get()));
  };
  const now = () => Date.now();

  return {
    ...emptyWorkspace(),
    ready: false,
    saving: false,
    storageError: null,

    async init() {
      try {
        const ws = await kvGet<Workspace>(KEY);
        set({ ...emptyWorkspace(), ...(ws ?? {}), settings: { ...emptyWorkspace().settings, ...(ws?.settings ?? {}) }, ready: true, storageError: null });
      } catch (e) {
        console.error('[autofill] storage unavailable', e);
        set({ ready: true, storageError: e instanceof Error ? e.message : String(e) });
      }
    },

    replaceWorkspace(ws) {
      mutate(() => ({ ...ws, settings: { ...emptyWorkspace().settings, ...ws.settings } }));
    },

    setSettings(patch) {
      mutate((s) => ({ settings: { ...s.settings, ...patch } }));
    },

    addForm(form) {
      mutate((s) => ({ forms: [...s.forms, form], settings: { ...s.settings, activeFormId: form.id } }));
    },
    updateForm(id, fn) {
      mutate((s) => ({ forms: s.forms.map((f) => (f.id === id ? { ...fn(f), updatedAt: now() } : f)) }));
    },
    updateSections(formId, fn) {
      get().updateForm(formId, (f) => ({ ...f, sections: fn(f.sections) }));
    },
    renameFieldKey(formId, from, to) {
      if (from === to) return;
      const move = (v: Values) => {
        if (!(from in v)) return v;
        const { [from]: val, ...rest } = v;
        return { ...rest, [to]: val };
      };
      const fixCond = <T extends { showIf?: { field: string } }>(x: T): T =>
        x.showIf?.field === from ? { ...x, showIf: { ...x.showIf, field: to } } : x;
      mutate((s) => ({
        forms: s.forms.map((f) =>
          f.id !== formId
            ? f
            : {
                ...f,
                globalValues: move(f.globalValues),
                sections: f.sections.map((sec) => fixCond({ ...sec, fields: sec.fields.map((fd) => fixCond(fd.key === from ? { ...fd, key: to } : fd)) })),
                updatedAt: now(),
              },
        ),
        sets: s.sets.map((st) => (st.formId !== formId ? st : { ...st, values: move(st.values), loadValues: move(st.loadValues) })),
        docs: s.docs.map((d) =>
          d.formId !== formId
            ? d
            : { ...d, outputName: renameToken(d.outputName, from, to), mappings: d.mappings.map((m) => ({ ...m, source: renameToken(m.source, from, to) })) },
        ),
        history: s.history.map((h) => (h.formId !== formId ? h : { ...h, loadValues: move(h.loadValues) })),
      }));
    },
    changeFieldScope(formId, key, scope) {
      mutate((s) => {
        const form = s.forms.find((f) => f.id === formId);
        const field = form && allFields(form).find((fd) => fd.key === key);
        if (!form || !field || field.scope === scope) return {};
        const sets = s.sets.filter((st) => st.formId === formId);
        const active = sets.find((st) => st.id === s.settings.activeSetId) ?? sets[0];
        // carry the most relevant existing value into the new home
        const current =
          field.scope === 'global' ? form.globalValues[key] : field.scope === 'set' ? active?.values[key] : active?.loadValues[key];
        const strip = (v: Values) => {
          const { [key]: _drop, ...rest } = v;
          void _drop;
          return rest;
        };
        const newForm: Form = {
          ...form,
          globalValues: scope === 'global' && current ? { ...form.globalValues, [key]: current } : strip(form.globalValues),
          sections: form.sections.map((sec) => ({ ...sec, fields: sec.fields.map((fd) => (fd.key === key ? { ...fd, scope } : fd)) })),
          updatedAt: now(),
        };
        return {
          forms: s.forms.map((f) => (f.id === formId ? newForm : f)),
          sets: s.sets.map((st) => {
            if (st.formId !== formId) return st;
            const own = field.scope === 'set' ? st.values[key] : field.scope === 'load' ? st.loadValues[key] : current;
            const val = own || current || '';
            return {
              ...st,
              values: scope === 'set' && val ? { ...st.values, [key]: val } : strip(st.values),
              loadValues: scope === 'load' && val ? { ...st.loadValues, [key]: val } : strip(st.loadValues),
            };
          }),
        };
      });
    },
    deleteForm(id) {
      const docs = get().docs.filter((d) => d.formId === id);
      for (const d of docs) {
        forgetPdf(d.fileId);
        void deleteFile(d.fileId);
      }
      mutate((s) => ({
        forms: s.forms.filter((f) => f.id !== id),
        sets: s.sets.filter((st) => st.formId !== id),
        docs: s.docs.filter((d) => d.formId !== id),
        history: s.history.filter((h) => h.formId !== id),
        settings: s.settings.activeFormId === id ? { ...s.settings, activeFormId: s.forms.find((f) => f.id !== id)?.id, activeSetId: undefined } : s.settings,
      }));
    },

    setValue(formId, setId, key, value) {
      const form = get().forms.find((f) => f.id === formId);
      const field = form && allFields(form).find((f) => f.key === key);
      if (!form || !field) return;
      if (field.scope === 'global') {
        get().updateForm(formId, (f) => ({ ...f, globalValues: { ...f.globalValues, [key]: value } }));
      } else if (setId) {
        const prop = field.scope === 'set' ? 'values' : 'loadValues';
        mutate((s) => ({ sets: s.sets.map((st) => (st.id === setId ? { ...st, [prop]: { ...st[prop], [key]: value }, updatedAt: now() } : st)) }));
      }
    },
    setValues(formId, setId, values) {
      const form = get().forms.find((f) => f.id === formId);
      if (!form) return;
      const byKey = new Map(allFields(form).map((f) => [f.key, f.scope]));
      const g: Values = {};
      const sv: Values = {};
      const lv: Values = {};
      for (const [k, v] of Object.entries(values)) {
        const sc = byKey.get(k);
        if (sc === 'global') g[k] = v;
        else if (sc === 'set') sv[k] = v;
        else if (sc === 'load') lv[k] = v;
      }
      mutate((s) => ({
        forms: s.forms.map((f) => (f.id === formId ? { ...f, globalValues: { ...f.globalValues, ...g }, updatedAt: now() } : f)),
        sets: s.sets.map((st) => (st.id === setId ? { ...st, values: { ...st.values, ...sv }, loadValues: { ...st.loadValues, ...lv }, updatedAt: now() } : st)),
      }));
    },

    addSet(formId, name, color, copyFrom) {
      const s = get();
      const src = copyFrom ? s.sets.find((x) => x.id === copyFrom) : undefined;
      const form = s.forms.find((f) => f.id === formId);
      const count = s.sets.filter((x) => x.formId === formId).length;
      const st: FormSet = {
        id: uid('set'),
        formId,
        name,
        color: color ?? SET_COLORS[count % SET_COLORS.length],
        values: src ? { ...src.values } : {},
        loadValues: form ? loadDefaults(form) : {},
        docIds: src ? [...src.docIds] : [],
        createdAt: now(),
        updatedAt: now(),
      };
      mutate((x) => ({ sets: [...x.sets, st], settings: { ...x.settings, activeFormId: formId, activeSetId: st.id } }));
      return st;
    },
    insertSets(list) {
      mutate((s) => ({ sets: [...s.sets, ...list] }));
    },
    updateSet(id, patch) {
      mutate((s) => ({ sets: s.sets.map((st) => (st.id === id ? { ...st, ...patch, updatedAt: now() } : st)) }));
    },
    deleteSet(id) {
      mutate((s) => ({
        sets: s.sets.filter((st) => st.id !== id),
        history: s.history.filter((h) => h.setId !== id),
        settings: s.settings.activeSetId === id ? { ...s.settings, activeSetId: undefined } : s.settings,
      }));
    },
    touchSet(id) {
      const s = get();
      if (s.settings.activeSetId === id && s.sets.find((x) => x.id === id)?.lastUsedAt) return;
      const st = s.sets.find((x) => x.id === id);
      mutate((x) => ({
        sets: x.sets.map((y) => (y.id === id ? { ...y, lastUsedAt: now() } : y)),
        settings: { ...x.settings, activeSetId: id, activeFormId: st?.formId ?? x.settings.activeFormId },
      }));
    },

    addDoc(doc, setIds = []) {
      mutate((s) => ({
        docs: [...s.docs, doc],
        sets: s.sets.map((st) => (setIds.includes(st.id) && !st.docIds.includes(doc.id) ? { ...st, docIds: [...st.docIds, doc.id] } : st)),
      }));
    },
    updateDoc(id, fn) {
      mutate((s) => ({ docs: s.docs.map((d) => (d.id === id ? { ...fn(d), updatedAt: now() } : d)) }));
    },
    deleteDoc(id) {
      const doc = get().docs.find((d) => d.id === id);
      if (doc && !get().docs.some((d) => d.id !== id && d.fileId === doc.fileId)) {
        forgetPdf(doc.fileId);
        void deleteFile(doc.fileId);
      }
      mutate((s) => ({ docs: s.docs.filter((d) => d.id !== id), sets: s.sets.map((st) => ({ ...st, docIds: st.docIds.filter((x) => x !== id) })) }));
    },

    newLoad(setId, label) {
      const s = get();
      const st = s.sets.find((x) => x.id === setId);
      const form = st && s.forms.find((f) => f.id === st.formId);
      if (!st || !form) return;
      const defaults = loadDefaults(form);
      const hasData = Object.entries(st.loadValues).some(([k, v]) => v && v !== defaults[k]);
      const entry: HistoryEntry | null = hasData
        ? {
            id: uid('h'),
            formId: form.id,
            setId,
            label: label || st.loadValues.load_number || st.loadValues.bol_number || `Load · ${new Date().toLocaleDateString()}`,
            loadValues: { ...st.loadValues },
            createdAt: now(),
          }
        : null;
      mutate((x) => ({
        sets: x.sets.map((y) => (y.id === setId ? { ...y, loadValues: defaults, updatedAt: now() } : y)),
        history: entry ? [entry, ...x.history].slice(0, 200) : x.history,
      }));
    },
    restoreHistory(entryId) {
      const h = get().history.find((x) => x.id === entryId);
      if (!h) return;
      mutate((s) => ({ sets: s.sets.map((st) => (st.id === h.setId ? { ...st, loadValues: { ...h.loadValues }, updatedAt: now() } : st)) }));
    },
    deleteHistory(entryId) {
      mutate((s) => ({ history: s.history.filter((h) => h.id !== entryId) }));
    },
  };
});

// other tabs of the app changed the workspace → reload it
channel?.addEventListener('message', (e) => {
  if (e.data?.type === 'changed' && e.data.from !== tabId) void useStore.getState().init();
});

// make sure a pending save lands when the tab goes away
const flushNow = () => {
  const s = useStore.getState();
  if (s.saving) persist.flush(pick(s));
};
window.addEventListener('pagehide', flushNow);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushNow());

// ------- selectors -------
export const useForm = (id?: string) => useStore((s) => s.forms.find((f) => f.id === id));
export const useSet = (id?: string) => useStore((s) => s.sets.find((f) => f.id === id));
export const useDoc = (id?: string) => useStore((s) => s.docs.find((d) => d.id === id));
