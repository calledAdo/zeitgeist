"""Oracle parameters. Changing any of these changes settlement; bump PARAMS_VERSION."""

PARAMS_VERSION = "v5.0"

EWMA_HALF_LIFE_H = 12.0        # attention decay half-life (spec v4)
LAMBDA = 0.35                  # heat sensitivity in target = e^(λh) / Σ
HEAT_CLAMP = 3.0
SIGMA_FLOOR = 0.15
CHARACTER_DAYS = 28            # trailing window for μ, σ
CHARACTER_MIN_DAYS = 14        # entity not eligible until this much history
TWAP_HOURS = 8.0               # funding reads the average target over this window
MIN_STORIES_PER_DAY = 20.0     # volume gate (normal unique stories/day)
PERSON_OFFSET_MAX = 500        # default centrality rule; the registry's person_offset_max is authoritative
EPS_STORIES = 0.02             # pseudo-count per batch so ln() is defined at zero
BATCH_MINUTES = 15
