import math
from datetime import datetime, timezone

from zeitgeist_indexer import oracle, params as P
from zeitgeist_indexer.gkg import Article, batch_range, normalize_title
from zeitgeist_indexer.match import company_hit, count_batch, person_hit
from zeitgeist_indexer.registry import load

REG = load()


def ent(cat, key):
    return next(e for e in REG.categories[cat] if e.key == key)


def art(title, persons=(), allnames=(), domain="example.com"):
    return Article(domain, normalize_title(title), tuple(persons), tuple(allnames))


# ---------- matching ----------

def test_person_central_mention_counts():
    a = art("Summit ends", persons=[("vladimir putin", 120)])
    assert person_hit(ent("geopolitics", "putin"), a, P.PERSON_OFFSET_MAX)


def test_person_deep_mention_needs_title():
    deep = art("Markets wrap", persons=[("vladimir putin", 4000)])
    assert not person_hit(ent("geopolitics", "putin"), deep, P.PERSON_OFFSET_MAX)
    titled = art("Putin warns Europe", persons=[("vladimir putin", 4000)])
    assert person_hit(ent("geopolitics", "putin"), titled, P.PERSON_OFFSET_MAX)


def test_xi_found_via_allnames():
    # GDELT's person extractor misses Xi; AllNames carries "chinese president xi jinping"
    a = art("Talks in Beijing", allnames=[("chinese president xi jinping", 80)])
    assert person_hit(ent("geopolitics", "xi"), a, P.PERSON_OFFSET_MAX)


def test_musk_ignores_allnames():
    a = art("Cybercabs hit the streets", allnames=[("elon musk", 50)])
    assert not person_hit(ent("tech_personalities", "musk"), a, P.PERSON_OFFSET_MAX)


def test_company_tier_a_word_boundary():
    nv = ent("tech_companies", "nvidia")
    assert company_hit(nv, art("Nvidia shares jump after earnings"))
    amd = ent("tech_companies", "amd")
    assert not company_hit(amd, art("Amdocs reports results"))


def test_company_blocklist():
    assert not company_hit(ent("tech_companies", "amazon"), art("Fires spread in the Amazon rainforest"))
    assert not company_hit(ent("tech_companies", "tesla"), art("Nikola Tesla museum reopens"))


def test_company_tier_b_needs_context():
    apple = ent("tech_companies", "apple")
    assert not company_hit(apple, art("Apple harvest season begins in Kent"))
    assert not company_hit(apple, art("Best apple pie recipes"))
    assert company_hit(apple, art("Apple unveils foldable iPhone"))
    assert company_hit(apple, art("Apple shares fall after earnings"))
    intel = ent("tech_companies", "intel")
    assert not company_hit(intel, art("House intel committee subpoenas"))
    assert not company_hit(intel, art("Intelligence agencies warn"))
    assert company_hit(intel, art("Intel foundry wins chip order"))


def test_count_batch_dedups_titles_and_drops_pr_wires():
    arts = (
        art("Putin meets Xi", persons=[("vladimir putin", 10)], domain="a.com"),
        art("Putin meets Xi", persons=[("vladimir putin", 10)], domain="b.com"),   # syndicated copy
        art("Putin meets Xi again", persons=[("vladimir putin", 10)], domain="prnewswire.com"),
        art("Weather today", domain="c.com"),
    )
    corpus, counts, domains = count_batch(REG, arts, P.PERSON_OFFSET_MAX)
    assert corpus == 2
    assert counts[("geopolitics", "putin")] == 1
    assert domains[("geopolitics", "putin")] == 2


# ---------- oracle math ----------

def test_ewma_half_life_is_12h():
    stamps = batch_range(datetime(2026, 9, 1, tzinfo=timezone.utc), datetime(2026, 9, 3, tzinfo=timezone.utc))
    n = {stamps[0]: 1000}  # one spike, then silence
    corpus = [1000] * len(stamps)
    path = oracle.ewma_path(stamps, corpus, n)
    i12 = stamps.index("20260901120000")
    assert math.isclose((path[i12] - P.EPS_STORIES / 1000) / (path[0] - P.EPS_STORIES / 1000), 0.5, rel_tol=1e-9)


def test_ewma_handles_gaps_by_time():
    # hourly sampling must decay the same per hour as 15-minute sampling
    s15 = batch_range(datetime(2026, 9, 1, tzinfo=timezone.utc), datetime(2026, 9, 2, tzinfo=timezone.utc))
    s60 = s15[::4]
    a = oracle.ewma_path(s15, [100] * len(s15), {s15[0]: 50})
    b = oracle.ewma_path(s60, [100] * len(s60), {s60[0]: 50})
    assert math.isclose(a[-1], b[-1], rel_tol=1e-9)


def test_targets_equal_at_rest_and_sum_to_one():
    t = oracle.targets({"a": 0.0, "b": 0.0, "c": 0.0, "d": 0.0})
    assert all(math.isclose(v, 0.25) for v in t.values())
    t = oracle.targets({"hot": 3.0, "a": 0.0, "b": 0.0})
    assert math.isclose(sum(t.values()), 1.0)
    assert math.isclose(t["hot"] / t["a"], math.exp(P.LAMBDA * 3))  # ≈ 2.86×


def test_heat_clamped_and_relative_to_character():
    steady = oracle.Character(True, 28, math.log(0.05), 0.15, 5000, math.exp(0.15))
    volatile = oracle.Character(True, 28, math.log(0.002), 0.6, 200, math.exp(0.6))
    # +2.4% for the steady giant is noise; +47% for the volatile one is real heat
    assert oracle.heat(0.05 * 1.024, steady) < 0.2
    assert oracle.heat(0.002 * 1.47, volatile) > 0.6
    assert oracle.heat(1.0, steady) == P.HEAT_CLAMP
    assert oracle.heat(0.0, steady) == -P.HEAT_CLAMP


def test_character_sigma_floor_and_readiness():
    days = [f"202609{d:02d}" for d in range(1, 29)]
    n = {d: 100 for d in days}
    c = {d: 10000 for d in days}
    b = {d: 96 for d in days}
    ch = oracle.character(n, c, b, days)
    assert ch.ready and ch.sigma == P.SIGMA_FLOOR and math.isclose(ch.per_day, 100)
    short = oracle.character(n, c, b, days[:5])
    assert not short.ready


def test_to_wad_sums_exactly():
    w = oracle.to_wad({"a": 1 / 3, "b": 1 / 3, "c": 1 / 3}, ["a", "b", "c"])
    assert sum(w) == 10**18


def test_character_anchor_is_thursday():
    a = oracle.character_anchor(datetime(2026, 10, 3, 15, tzinfo=timezone.utc))
    assert a.weekday() == 3 and a.hour == 0 and a <= datetime(2026, 10, 3, 15, tzinfo=timezone.utc)


def test_batch_range_grid_is_clock_aligned():
    a = batch_range(datetime(2026, 9, 1, 0, 40, tzinfo=timezone.utc), datetime(2026, 9, 1, 5, tzinfo=timezone.utc), 4)
    b = batch_range(datetime(2026, 9, 1, 1, 10, tzinfo=timezone.utc), datetime(2026, 9, 1, 5, tzinfo=timezone.utc), 4)
    assert all(x.endswith("0000") for x in a + b)
    assert set(b) <= set(a)


def test_accents_and_gdelt_truncation():
    e = ent("geopolitics", "erdogan")
    assert person_hit(e, art("Talks in Ankara", persons=[("recep tayyip erdo", 40)]), P.PERSON_OFFSET_MAX)
    assert normalize_title("Erdoğan meets Lula") == "erdogan meets lula"
    assert person_hit(e, art("Erdoğan hosts summit", persons=[("tayyip erdogan", 900)]), P.PERSON_OFFSET_MAX)


def test_offset_500_counts_second_paragraph():
    e = ent("geopolitics", "putin")
    a = art("Markets wrap", persons=[("vladimir putin", 420)])
    assert e.offset_max == 500 and person_hit(e, a, e.offset_max)


def test_listed_slots_are_contiguous():
    tp = REG.listed("tech_personalities")
    assert [e.key for e in tp] == ["zuckerberg", "musk", "amodei", "altman", "gates", "cook", "huang"]
    assert all(e.index is None for e in REG.categories["tech_personalities"] if e.key == "pichai")
