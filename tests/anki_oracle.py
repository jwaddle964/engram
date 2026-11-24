"""Generate scheduling scenarios and record what REAL Anki (rsbridge backend) does.
Run with ANKI_TEST_MODE=1 so Anki disables fuzz (deterministic)."""
import json, os, random, sys, tempfile, time
from anki.collection import Collection
from anki.cards import FSRSMemoryState

random.seed(int(sys.argv[2]) if len(sys.argv) > 2 else 1)
out_path = sys.argv[1]
def fresh():
    tmp = tempfile.mkdtemp()
    col = Collection(os.path.join(tmp, "c.anki2"))
    col.set_config("fsrs", True)
    model = col.models.by_name("Basic")
    note = col.new_note(model)
    note["Front"] = "q"; note["Back"] = "a"
    col.add_note(note, 1)
    return col, note.card_ids()[0]
col, cid = fresh()
DEF = [0.212,1.2931,2.3065,8.2956,6.4133,0.8334,3.0194,0.001,1.8722,0.1666,0.796,1.4835,0.0614,0.2629,1.6483,0.6014,1.8729,0.5425,0.0912,0.0658,0.1542]

def rand_params():
    if random.random() < 0.5:
        return DEF
    lo = [0.001,0.001,0.001,0.001,1,0.001,0.001,0.001,0,0,0.001,0.001,0.001,0.001,0,0,1,0,0,0,0.1]
    hi = [100,100,100,100,10,4,4,0.75,4.5,0.8,3.5,5,0.25,0.9,4,1,6,2,2,0.8,0.8]
    w = []
    for i,(a,b) in enumerate(zip(lo,hi)):
        v = DEF[i] * random.uniform(0.6, 1.5)
        w.append(round(min(max(v, a), b), 4))
    w[0], w[1], w[2], w[3] = sorted(w[:4])
    return w

def parse_state(cs):
    # cs: anki.scheduler_pb2.SchedulingState
    kind = cs.WhichOneof("kind")
    if kind == "filtered":
        raise RuntimeError("filtered")
    n = cs.normal
    k = n.WhichOneof("kind")
    def mem(ms):
        return {"s": ms.stability, "d": ms.difficulty}
    if k == "new":
        return {"kind": "new"}
    if k == "learning":
        l = n.learning
        return {"kind": "learn", "remaining": l.remaining_steps, "secs": l.scheduled_secs, "mem": mem(l.memory_state)}
    if k == "review":
        r = n.review
        return {"kind": "review", "scheduledDays": r.scheduled_days, "lapses": r.lapses, "leeched": r.leeched, "mem": mem(r.memory_state)}
    if k == "relearning":
        rl = n.relearning
        return {"kind": "relearn", "remaining": rl.learning.remaining_steps, "secs": rl.learning.scheduled_secs,
                "scheduledDays": rl.review.scheduled_days, "lapses": rl.review.lapses, "leeched": rl.review.leeched,
                "mem": mem(rl.learning.memory_state)}
    raise RuntimeError(k)

STEP_CHOICES = [[1, 10], [1], [], [10], [1, 10, 60], [5, 30, 1440], [2880], [15, 1440, 4320]]
RELEARN_CHOICES = [[10], [], [1, 10], [5, 1440], [30]]
scenarios = []
today = col.sched.today
N = int(os.environ.get("N", "400"))
for i in range(N):
    w = rand_params()
    steps = random.choice(STEP_CHOICES)
    rsteps = random.choice(RELEARN_CHOICES)
    dr = random.choice([0.9, 0.85, 0.95, 0.8, 0.97, 0.7])
    max_ivl = random.choice([36500, 36500, 365, 30, 7])
    leech = random.choice([8, 8, 3, 2, 1])
    conf = col.decks.config_dict_for_deck_id(1)
    conf["new"]["delays"] = steps
    conf["lapse"]["delays"] = rsteps
    conf["desiredRetention"] = dr
    conf["rev"]["maxIvl"] = max_ivl
    conf["lapse"]["leechFails"] = leech
    conf["fsrsParams6"] = w
    col.decks.update_config(conf)
    card = col.get_card(cid)
    ctype = random.choice([0, 1, 1, 2, 2, 2, 3, 3])
    now = int(time.time())
    sc = {"w": w, "steps": steps, "relearnSteps": rsteps, "dr": dr, "maxIvl": max_ivl, "leech": leech, "type": ctype}
    card.reps = random.randint(1, 30)
    card.lapses = random.randint(0, 12) if ctype in (2, 3) else 0
    if ctype == 0:
        card.type = 0; card.queue = 0; card.due = random.randint(1, 100); card.ivl = 0; card.left = 0
        card.memory_state = None; card.last_review_time = None; card.reps = 0
        sc.update(due=card.due, elapsed=None, mem=None, ivl=0, left=0)
    else:
        mem = {"s": round(random.choice([random.uniform(0.01, 2), random.uniform(1, 60), random.uniform(30, 3000)]), 4),
               "d": round(random.uniform(1, 10), 4)}
        card.memory_state = FSRSMemoryState(stability=mem["s"], difficulty=mem["d"])
        if ctype in (1, 3):
            st = steps if ctype == 1 else rsteps
            nsteps = max(len(st), 1)
            left = random.randint(1, nsteps)
            elapsed = random.choice([0, 0, 0, 1, 3])
            card.left = left
            card.type = ctype
            card.queue = 1
            card.due = now + 60
            card.ivl = random.randint(1, 200) if ctype == 3 else 0
        else:
            elapsed = random.choice([0, 1, 2, 5, 10, 30, 100, random.randint(1, 1000)])
            ivl = random.choice([1, 2, 3, 7, 15, 40, 100, random.randint(1, 2000), elapsed, max(elapsed - 3, 1)])
            card.type = 2; card.queue = 2; card.ivl = ivl; card.left = 0
            card.due = today - elapsed + ivl
        card.last_review_time = now - elapsed * 86400 - (30 if elapsed == 0 else 0)
        sc.update(due=card.due - today if ctype == 2 else 0, elapsed=elapsed, mem=mem, ivl=card.ivl, left=card.left)
    col.update_card(card)
    try:
        states = col._backend.get_scheduling_states(cid)
    except BaseException as e:  # anki panics on min>max clamp in test mode
        col, cid = fresh()
        continue
    sc["anki"] = {k: parse_state(getattr(states, k)) for k in ("again", "hard", "good", "easy")}
    scenarios.append(sc)

json.dump(scenarios, open(out_path, "w"))
print("wrote", len(scenarios), "scenarios; today =", today)
