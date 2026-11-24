"""Create an .apkg with a real Anki Image Occlusion note, plus dump its exact note type."""
import os, sys, tempfile, json, struct, zlib
from anki.collection import Collection, ExportAnkiPackageOptions, DeckIdLimit
out = sys.argv[1]
tmp = tempfile.mkdtemp()
col = Collection(os.path.join(tmp, "collection.anki2"))
# 200x100 PNG: left half blue, right half green
w, hgt = 200, 100
rows = b"".join(b"\x00" + b"".join((b"\x30\x60\xd0" if x < 100 else b"\x30\xa0\x50") for x in range(w)) for y in range(hgt))
def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, hgt, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")
img = os.path.join(tmp, "diagram.png")
open(img, "wb").write(png)
col.add_image_occlusion_notetype()
nt = [m for m in col.models.all() if m.get("originalStockKind") == 6 or "Occlusion" in m["name"]][0]
print("notetype:", nt["name"], [f["name"] for f in nt["flds"]])
json.dump({"name": nt["name"], "fields": [f["name"] for f in nt["flds"]], "qfmt": nt["tmpls"][0]["qfmt"], "afmt": nt["tmpls"][0]["afmt"], "css": nt["css"]}, open(os.path.join(out, "io_notetype.json"), "w"), indent=1)
occl = ("{{c1::image-occlusion:rect:left=.05:top=.1:width=.3:height=.2:oi=1}}<br>"
        "{{c2::image-occlusion:ellipse:left=.55:top=.5:width=.3:height=.3:rx=.15:ry=.15:oi=1}}<br>"
        "{{c3::image-occlusion:polygon:left=.4:top=.1:points=.4,.1 .5,.4 .3,.4:oi=1}}<br>")
col.add_image_occlusion_note(nt["id"], img, occl, "Label the parts", "extra info", ["bio"])
nid = col.find_notes("")[0]
note = col.get_note(nid)
print("fields:", dict(note.items()))
cid = note.card_ids()[0]
card = col.get_card(cid)
print("Q:", card.question()[:600])
path = os.path.join(out, "io.apkg")
col.export_anki_package(out_path=path, options=ExportAnkiPackageOptions(with_scheduling=False, with_media=True, legacy=False, with_deck_configs=False), limit=None)
print("wrote", path)
ref = {"occlusion": note["Occlusion"], "image": note["Image"], "cards": []}
for cid in note.card_ids():
    c = col.get_card(cid)
    import re
    q = c.question(); a = c.answer()
    pick = lambda html: re.search(r'<div style="display: none">(.*?)</div>\s*<div id="err">', html, re.S).group(1)
    ref["cards"].append({"ord": c.ord, "q": pick(q), "a": pick(a)})
json.dump(ref, open(os.path.join(out, "io_ref.json"), "w"), indent=1)
print("ref written", len(ref["cards"]))
