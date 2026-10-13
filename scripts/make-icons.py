# Renders the toolbar/store icons from the same SVG as the in-app logo.
import pymupdf, pathlib
svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7b7bf5"/><stop offset="1" stop-color="#4646c8"/></linearGradient></defs>
<rect x="2" y="2" width="60" height="60" rx="16" fill="url(#g)"/>
<path d="M20 14h17l9 9v27a3 3 0 0 1-3 3H20a3 3 0 0 1-3-3V17a3 3 0 0 1 3-3z" fill="#fff" fill-opacity="0.95"/>
<path d="M37 14v7a2 2 0 0 0 2 2h7" fill="none" stroke="#c9c9fb" stroke-width="2"/>
<rect x="22" y="29" width="14" height="3.4" rx="1.7" fill="#5b5bd6"/>
<rect x="22" y="36" width="19" height="3.4" rx="1.7" fill="#c9c9fb"/>
<rect x="22" y="43" width="11" height="3.4" rx="1.7" fill="#c9c9fb"/>
<path d="M43 36.5l2.2 4.6 4.8.6-3.5 3.3.9 4.8-4.4-2.4-4.3 2.4.9-4.8-3.5-3.3 4.8-.6z" fill="#ffb224" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>
</svg>'''
out = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'icons'
out.mkdir(parents=True, exist_ok=True)
doc = pymupdf.open(stream=svg.encode(), filetype='svg')
page = doc[0]
for size in (16, 32, 48, 128, 192, 512):
    pix = page.get_pixmap(matrix=pymupdf.Matrix(size / 64, size / 64), alpha=True)
    pix.save(str(out / f'icon{size}.png'))
print('ok')
