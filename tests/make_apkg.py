"""Create real .apkg/.colpkg files with the actual Anki engine, for testing the importer."""
import os, sys, tempfile, time, struct, zlib
from anki.collection import Collection, ExportAnkiPackageOptions, DeckIdLimit
from anki.cards import FSRSMemoryState

out = sys.argv[1]
tmp = tempfile.mkdtemp()
col = Collection(os.path.join(tmp, "collection.anki2"))
col.set_config("fsrs", True)
# tiny PNG
def png():
    raw = b"\x00\xff\x00\x00" * 4
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"\x00" + b"\xff\x00\x00" * 2 + b"\x00" + b"\x00\x00\xff" * 2)) + chunk(b"IEND", b"")
fname = col.media.write_data("dot.png", png())
did = col.decks.id("Shared::Vocab")
did2 = col.decks.id("Shared::Cloze")
basic = col.models.by_name("Basic")
cloze = col.models.by_name("Cloze")
# custom note type with css + 3 fields
mm = col.models
custom = mm.new("Vocab Custom")
for f in ["Word", "Meaning", "Example"]:
    mm.add_field(custom, mm.new_field(f))
t = mm.new_template("Recognition")
t["qfmt"] = "<div class=word>{{Word}}</div>{{#Example}}<div class=ex>{{hint:Example}}</div>{{/Example}}"
t["afmt"] = "{{FrontSide}}<hr id=answer>{{Meaning}}"
mm.add_template(custom, t)
t2 = mm.new_template("Production")
t2["qfmt"] = "{{Meaning}}"
t2["afmt"] = "{{FrontSide}}<hr id=answer>{{Word}}"
mm.add_template(custom, t2)
custom["css"] = ".card { font-family: Georgia; font-size: 24px; text-align: center; } .word { color: #a0522d; }"
mm.add(custom)
custom = mm.by_name("Vocab Custom")
for i in range(5):
    n = col.new_note(basic); n["Front"] = f"perro {i} <img src=\"{fname}\">"; n["Back"] = f"dog <b>{i}</b> \\(x^{i}\\)"; n.tags = ["spanish", "animals"]
    col.add_note(n, did)
n = col.new_note(cloze); n["Text"] = "The {{c1::mitochondria}} is the {{c2::powerhouse::hint}} of the cell"; n["Back Extra"] = "biology"
col.add_note(n, did2)
n = col.new_note(custom); n["Word"] = "gato"; n["Meaning"] = "cat"; n["Example"] = "El gato duerme."
col.add_note(n, did)
# review some cards so scheduling exists
col.sched.reset() if hasattr(col.sched, "reset") else None
cids = col.find_cards(f"did:{did}")
for cid in cids[:3]:
    c = col.get_card(cid)
    for rating in (3, 3):
        c = col.get_card(cid)
        c.start_timer()
        states = col._backend.get_scheduling_states(cid)
        ans = col.sched.build_answer(card=c, states=states, rating=rating)
        col.sched.answer_card(ans)
print("reviewed", [ (col.get_card(c).type, col.get_card(c).queue, col.get_card(c).ivl, col.get_card(c).due) for c in cids[:3]])
print("today", col.sched.today, "crt", col.crt)
for legacy in (False, True):
    path = os.path.join(out, "shared-%s.apkg" % ("legacy" if legacy else "new"))
    col.export_anki_package(out_path=path, options=ExportAnkiPackageOptions(with_scheduling=True, with_media=True, legacy=legacy, with_deck_configs=False), limit=DeckIdLimit(col.decks.id("Shared")))
    print("wrote", path, os.path.getsize(path))
path = os.path.join(out, "noschedule.apkg")
col.export_anki_package(out_path=path, options=ExportAnkiPackageOptions(with_scheduling=False, with_media=True, legacy=False, with_deck_configs=False), limit=DeckIdLimit(col.decks.id("Shared")))
print("wrote", path)
col.export_collection_package(os.path.join(out, "full.colpkg"), include_media=True, legacy=False)
print("wrote colpkg")
