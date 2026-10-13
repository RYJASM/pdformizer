# Autofill My PDF

A Chrome extension (Manifest V3) for filling the same PDF paperwork over and over. You enter your info once, map it onto any PDF (bills of lading, rate confirmations, trip sheets, carrier packets), and then fill, sign, save and print it for every load.

Everything runs locally in the browser. No servers and no accounts, and nothing leaves the computer.

## Run it

```bash
npm install
npm run build        # type-checks, then builds into dist/
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the `dist/` folder. Clicking the toolbar icon opens the app in a tab.

| Command | What it does |
| --- | --- |
| `npm run dev` | Rebuilds `dist/` on every change. Reload the extension to pick it up. |
| `npm test` | Unit tests: templates, layout, text-file import, auto-map, conditions, and the PDF fill engine. |
| `npm run typecheck` | TypeScript only. |
| `python scripts/make-icons.py` | Regenerates the toolbar icons (needs `pymupdf`). |

## How it's organised

| Concept | Meaning |
| --- | --- |
| **Form** | The fields you reuse: sections, field types, conditional "only show when…" rules. |
| **Field scope** | Where a value lives. **Everywhere** is for your name, CDL and signature. **This set** is per employer or truck. **Each load** is cleared by *New load* and archived to history. |
| **Set** | One job setup, e.g. *Employer A · Truck 12*. It has its own values and its own list of PDFs. |
| **Document** | An imported PDF plus its mappings. A document can be shared by several sets. |
| **Mapping** | Connects a PDF spot to your data. The spot is either a real fillable field (AcroForm) or a free text box placed on a flat PDF. The source is a template such as `{shipper_name}\n{shipper_address}` or `{pickup_date\|date:MM/DD/YY}`. |

### Code map

```
src/
  background.ts          toolbar click → open/focus the app tab
  lib/
    types.ts             data model
    store.ts             zustand store, IndexedDB persistence, cross-tab sync
    values.ts            scope routing, conditional visibility, sample data
    template.ts          {token|filter} rendering, dates
    layout.ts            text layout shared by the on-screen preview and the PDF writer
    automap.ts           fuzzy name matching of PDF fields to form fields
    textdata.ts          human-editable .txt export/import with diff preview
    bundle.ts            form templates & full backups (JSON)
    signature.ts         photo-to-signature extraction
    pdf/pdfjs.ts         pdf.js: open, analyse fields, cached page rendering
    pdf/fill.ts          pdf-lib: fill fields, draw overlays/signatures, flatten, merge (runs in a Web Worker)
    pdf/output.ts        worker client, save (chrome.downloads), print, open
    sample.ts            generates the sample BOL + trip sheet at runtime
  features/              home, wizard, fill, mapper, builder, data, signature
```

### Design notes

- **The preview matches the output.** The on-screen preview draws values in an SVG layer, using the same `layoutText()` the PDF writer uses. Arial and Helvetica share metrics, so what you see while typing is what prints.
- **Generation never blocks typing.** pdf-lib runs in a Web Worker. Page bitmaps are cached, and pages render lazily as they scroll into view.
- **Fragile PDFs are handled.** pdf-lib failures on odd fields fall back to drawing the text in place. Non-WinAnsi characters are swapped for close equivalents instead of throwing. XFA is stripped. Dangling annotations left behind by `flatten()` are pruned.
- **Photo signatures** are normalised against a local estimate of the paper brightness, which removes shadows. Otsu's method finds the ink/paper split, and the cut-off sits just above the paper's noise floor. Ink darkness then maps to a soft alpha ramp, so strokes stay anti-aliased instead of looking blown out. Three sliders (clean-up, ink darkness and edge smoothness) and an **Auto** button let you adjust the result.

## Data files

**Data → Export .txt** writes plain `name: value` lines grouped under `[Shared]`, `[Set: …]` and `[Load: …]`. You can edit the file in any text editor. The importer accepts `:` or `=`, any capitalisation, labels instead of keys, and `yes`/`no` and most date formats. It shows a diff and warnings before anything changes. **Data → Edit as text** does the same edit in the app.

## Permissions

`downloads` saves filled PDFs into a sub-folder of Downloads. `unlimitedStorage` lets IndexedDB hold your PDFs. The extension has no host permissions and makes no network requests.
