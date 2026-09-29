"""Ad-hoc inspection of bodies.json / facts.json (read-only)."""
import json
from collections import Counter

BODIES = json.load(open('src/data/bodies.json'))['bodies']
FACTS = json.load(open('src/data/facts.json'))

print('facts.json top keys:', list(FACTS.keys()))
print('n bodies:', len(BODIES))
print('body keys:', sorted(BODIES[0].keys()))
print('example body:', json.dumps(BODIES[0], ensure_ascii=False)[:600])
print('types:', Counter(b.get('type') for b in BODIES))
no_radius = [b['id'] for b in BODIES if not b.get('radiusKm')]
print('ohne radiusKm:', no_radius)
print()
fb = FACTS.get('bodies', {})
print('facts.bodies count:', len(fb))
print('fact keys:', sorted(next(iter(fb.values())).keys()))
print('example fact:', json.dumps(list(fb.items())[0], ensure_ascii=False)[:600])
missing = [b['id'] for b in BODIES if b['id'] not in fb]
print('bodies ohne facts:', len(missing), missing[:10])
print()
for key in FACTS:
    if key != 'bodies':
        v = FACTS[key]
        print(key, type(v).__name__, len(v) if hasattr(v, '__len__') else '')
print()
moons = [b for b in BODIES if b.get('parent')]
print('monde:', len(moons))
print('parent values:', Counter(b.get('parent') for b in moons))
print('moon example:', json.dumps(moons[0], ensure_ascii=False))
print('discoveries sample:', [b.get('discovery') for b in moons[:12]])
