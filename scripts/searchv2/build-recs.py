#!/usr/bin/env python3
"""Build public/searchv2-data/recs.json: the differential families used for "Also consider" recommendations.

Source: /root/catalogue/differentials/families.json (40 families, curated from WHO chapter structure +
Pathology Outlines differentials). Each member is resolved to the catalogue's diagnosis labels (the worker's
group keys): label == member, or label starts with the member followed by a space, with the member's own
spelling variants (tumour/tumor, ae/e, oe/e) handled by the shared norm(). Members with no cases are dropped.
Normalisation must match norm() in public/searchv2-data/worker.js and build-index.py.
"""
import json, re, sqlite3, unicodedata, collections
from pathlib import Path
ROOT = Path('/var/www/website'); OUT = ROOT / 'public' / 'searchv2-data'
FAM = json.load(open('/root/catalogue/differentials/families.json'))['families']

def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    s = s.replace('tumour', 'tumor').replace('oe', 'e').replace('ae', 'e')
    s = re.sub(r'[^a-z0-9]+', ' ', s).strip()
    return re.sub(r'\s+', ' ', s)

c = sqlite3.connect(f"file:{ROOT/'data-catalogue'/'site.sqlite'}?mode=ro", uri=True)
labels = collections.Counter()
for (lab,) in c.execute("select coalesce(nullif(l.clean_label,''),c.title) from cases c left join case_labels l on l.case_id=c.id"):
    labels[norm(lab)] += 1

def resolve(member):
    k = norm(member)
    keys = [lab for lab in labels if lab == k or lab.startswith(k + ' ')]
    # avoid "metastatic …" and "… ex …" style labels that only contain the member
    keys = [lab for lab in keys if not lab.startswith(k + ' ex ')]
    return k, keys, sum(labels[x] for x in keys)

out = []
for f in FAM:
    members = []
    for m in f['members']:
        name = m[3:] if m.startswith('po:') else m
        k, keys, n = resolve(name)
        if n == 0: continue
        members.append({'name': name, 'key': k, 'n': n})
    out.append({'id': f['id'], 'name': f['name'], 'anchors': [norm(a) for a in f['anchors']], 'members': members})
raw = json.dumps({'families': out}, ensure_ascii=False, separators=(',', ':')).encode()
(OUT / 'recs.json').write_bytes(raw)
print(f"families {len(out)} members {sum(len(f['members']) for f in out)} bytes {len(raw)}")
for f in out[:3]: print(' ', f['name'], '→', ', '.join(f"{m['name']} ({m['n']})" for m in f['members'][:6]), '…')
