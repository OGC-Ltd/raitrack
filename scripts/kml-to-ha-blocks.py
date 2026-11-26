"""
Kasulu's four hectare blocks -- the 700, 1600, 2500 and 2000 Ha areas -- from
the operations team's Google Earth file, merged into public/estate-plan.geojson
as class `hablock` for FleetMap's planting-plan layer.

    python scripts/kml-to-ha-blocks.py "tools/kasulu-ha-blocks.kml" public/estate-plan.geojson

The file (tools/kasulu-ha-blocks.kml, a GPS/Google Earth export, so WGS 84
lon/lat as KML requires) draws each block as a closed line under its working
name and drops a label pin, "700 Ha Area" and so on, inside it:

    pin             outline it sits in    block
    700 Ha Area     Nursery - B           NURSERY B on the surveyor's sheet
    1600 Ha Area    Commercial Area       COMMERCIAL
    2500 Ha Area    2500 Ha Area          ZONE 4
    2000 Ha Area    Rainfed Area          RAIN FED

The pairing is not trusted from this table: each pin must fall inside exactly
the outline named here, or the script stops. The outline's computed area is
printed beside the figure in its name; they differ by a few percent because the
names are round working figures (see FleetMap ZONE_PLAN_ALIAS for the sheet's
own printed numbers, which differ again).

Not taken from the file: Nursery A, the six unnamed outlines (FARM#210-215, the
estate boundary among them -- already in the plan from the drawing), and the
place pins (towns, intakes, quarry). Re-running replaces the `hablock` features
and leaves every other feature of the plan alone.

Each feature carries `c` ("hablock"), `n` (the block's name, "700 Ha Area"),
`a` (computed area, ha), `ha` (the nominal figure) and `k` (the outline's name
in the file).
"""

import json
import math
import sys
import xml.etree.ElementTree as ET

K = "{http://www.opengis.net/kml/2.2}"

# pin name in the file -> (outline name in the file, nominal hectares)
BLOCKS = {
    "700 Ha Area": ("Nursery - B", 700),
    "1600 Ha Area": ("Commercial Area", 1600),
    "2500 Ha Area": ("2500 Ha Area", 2500),
    "2000 Ha Area": ("Rainfed Area", 2000),
}

R = 6371008.8  # mean Earth radius, m


def area_ha(ring):
    """Spherical polygon area (lon/lat degrees), hectares."""
    s = 0.0
    for (lo1, la1), (lo2, la2) in zip(ring, ring[1:] + ring[:1]):
        s += math.radians(lo2 - lo1) * (2 + math.sin(math.radians(la1)) + math.sin(math.radians(la2)))
    return abs(s) * R * R / 2 / 1e4


def inside(pt, ring):
    x, y = pt
    hit = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            hit = not hit
    return hit


def coords(el):
    return [tuple(float(v) for v in s.split(",")[:2]) for s in el.text.split()]


def main(kml_path, plan_path):
    root = ET.parse(kml_path).getroot()
    pins, outlines = {}, {}
    for pm in root.iter(K + "Placemark"):
        name = (pm.findtext(K + "name") or "").strip()
        pt = pm.find(f"{K}Point/{K}coordinates")
        ln = pm.find(f".//{K}LineString/{K}coordinates")
        if ln is None:
            ln = pm.find(f".//{K}LinearRing/{K}coordinates")
        if pt is not None:
            pins[name] = coords(pt)[0]
        elif ln is not None and name in {o for o, _ in BLOCKS.values()}:
            # "2500 Ha Area" is both a pin and an outline; the outline is the
            # LineString, so it is keyed apart from the pin.
            outlines[name] = coords(ln)

    for lon, lat in [p for r in outlines.values() for p in r] + list(pins.values()):
        if not (29 < lon < 32 and -6 < lat < -2):
            sys.exit(f"coordinate {lon},{lat} is not near Kasulu -- not WGS 84 lon/lat?")

    feats = []
    for pin, (outline, nominal) in BLOCKS.items():
        if pin not in pins or outline not in outlines:
            sys.exit(f"missing in the KML: pin {pin!r} or outline {outline!r}")
        ring = outlines[outline]
        if ring[0] != ring[-1]:
            sys.exit(f"{outline!r} is not closed")
        homes = [o for o, r in outlines.items() if inside(pins[pin], r[:-1])]
        if homes != [outline]:
            sys.exit(f"pin {pin!r} sits in {homes}, expected only {outline!r}")
        a = round(area_ha(ring[:-1]), 1)
        print(f"{pin:<13} <- {outline:<16} {a:>8.1f} ha computed, {nominal} nominal "
              f"({(a - nominal) / nominal:+.1%})", file=sys.stderr)
        feats.append({
            "type": "Feature",
            "properties": {"c": "hablock", "n": pin, "a": a, "ha": nominal, "k": outline},
            "geometry": {"type": "Polygon",
                         "coordinates": [[[round(x, 6), round(y, 6)] for x, y in ring]]},
        })

    with open(plan_path, encoding="utf-8") as f:
        plan = json.load(f)
    plan["features"] = [f for f in plan["features"] if f["properties"].get("c") != "hablock"] + feats
    plan["hablocks"] = "tools/kasulu-ha-blocks.kml via scripts/kml-to-ha-blocks.py"
    with open(plan_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(plan, f, separators=(",", ":"))


if __name__ == "__main__":
    main(*sys.argv[1:3])
