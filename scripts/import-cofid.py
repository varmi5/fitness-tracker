"""Extract the public CoFID 2021 macronutrients using only Python's standard library.
Usage: python3 scripts/import-cofid.py /path/to/CoFID.xlsx
Source and licence are documented in data/README.md. No production data is written.
"""
import json, re, sys, zipfile, xml.etree.ElementTree as ET
from pathlib import Path
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(sys.argv[1]) as archive:
    strings = [''.join(item.itertext()) for item in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si', ns)]
    def rows(sheet):
        for row in ET.fromstring(archive.read(sheet)).findall('s:sheetData/s:row', ns)[3:]:
            yield {re.sub(r'\d+', '', cell.attrib['r']): strings[int(cell.find('s:v', ns).text)] if cell.attrib.get('t') == 's' else cell.findtext('s:v', '', ns) for cell in row}
    density = {row['A']: row.get('I', '') for row in rows('xl/worksheets/sheet3.xml') if row.get('A')}
    def number(raw):
        # Tr, N and blanks are not measured zeroes.
        try: return float(raw) if str(raw).strip() else None
        except (ValueError, TypeError): return None
    foods = []
    for row in rows('xl/worksheets/sheet4.xml'):
        if not row.get('A') or not row.get('B'): continue
        foods.append({'code': row['A'], 'name': row['B'], 'group': row.get('D', ''), 'density': number(density.get(row['A'])),
            'calories': number(row.get('M')), 'proteinG': number(row.get('J')), 'carbsG': number(row.get('L')),
            'fatG': number(row.get('K')), 'fibreG': number(row.get('Z'))})
Path('data/cofid-2021.json').write_text(json.dumps(foods, separators=(',', ':'), ensure_ascii=False) + '\n')
print(f'Extracted {len(foods)} public UK reference foods')
