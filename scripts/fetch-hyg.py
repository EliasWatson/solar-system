# Bake bright/nearby stars from the HYG database v4.1 (CC BY-SA 4.0). Run: python3 scripts/fetch-hyg.py
import csv, io, json, urllib.request
URL = 'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv'
data = urllib.request.urlopen(URL).read().decode()
out = []
for r in csv.DictReader(io.StringIO(data)):
    if r['id'] == '0': continue
    try: d = float(r['dist']); mag = float(r['mag']); absmag = float(r['absmag'])
    except ValueError: continue
    if d <= 0 or d >= 100000: continue
    if not (mag <= 6.5 or d < 16): continue
    ci = float(r['ci']) if r['ci'] else 0.65
    name = r['proper'] or ''
    if not name and r['bayer'] and mag < 3.5: name = f"{r['bayer']} {r['con']}"
    out.append([round(float(r['x']), 4), round(float(r['y']), 4), round(float(r['z']), 4), round(absmag, 2), round(ci, 2), name])
json.dump({'source': 'HYG v4.1 (astronexus, CC BY-SA 4.0)', 'stars': out}, open('public/data/stars.json', 'w'), separators=(',', ':'))
print(len(out), 'stars')
