# Cross-reference: my registry vs. `API_endpoint_guide_for_forecast_questions.md`

Two independent passes over the same ~230-question list. Broad agreement on the
core (FRED, BLS, EIA, SEC EDGAR, Congress.gov, CourtListener, Federal Register,
CDC SODA, ClinicalTrials v2, openFDA, CISA KEV, FSIS, CPSC, PEGELONLINE, OCHA,
Launch Library, arXiv, MediaWiki, GitHub). This document covers only where they
diverge.

The guide's overall standard is stricter than mine and mostly better: it
separates "useful for forecasting" from "valid for resolution," and it refuses
to promote undocumented internal web endpoints to the status of public APIs.
Adopt that framing. My registry blurred the two in several places.

---

## 1. Guide is right, my registry was wrong or missing — ADOPT

| Item | Detail |
|---|---|
| **FDIC failures API** | `GET https://api.fdic.gov/banks/failures?filters=FAILDATE:[2026-08-01 TO 2026-08-31]`. Direct hit for "how many U.S. banks will fail in August 2026." I omitted this entirely. |
| **GDELT DOC 2.0** | `https://api.gdeltproject.org/api/v2/doc/doc`. My largest single omission. Roughly 30 questions in the list are event-detection (Putin–Trump call, Putin visits Iran/Kyrgyzstan, IAEA inspection, NK nuclear test, Taiwan blockade, ceasefires, arms deals, New START, Massie filing, DeSantis endorsement). I had no discovery layer for these at all. The guide is also right that it is discovery only, never resolution. |
| **IOM Missing Migrants** | I filed this under `no_api`. Wrong — there is a public ArcGIS FeatureServer at `services7.arcgis.com/IyvyFk20mB7Wpc95/.../FeatureServer/0/query`. |
| **State Dept advisories** | I used the RSS feed. The guide's `https://cadataapi.state.gov/api/TravelAdvisories` is a proper JSON API with per-ISO2 lookup. Strictly better. |
| **WHO outbreak news API** | `https://www.who.int/api/news/outbreaks`. I dismissed WHO DON as RSS-only. This is the correct route for the Bundibugyo Ebola case-count and province-spread questions. |
| **Metaculus endpoint** | Guide uses `/api/posts/{id}/`; I used the older `/api2/questions/`. Guide's is current. |
| **Case-Shiller series** | Guide's `CSUSHPISA` (seasonally adjusted) is correct; my `CSUSHPINSA` is the NSA series and the question specifies SA. My error. |
| **Launch Library version** | 2.3.0, not my 2.2.0. |
| **PEGELONLINE station ID** | Guide uses the UUID `1d26e504-7f9e-480a-b52c-5932be6549ab`; I used the shortname `KAUB`. Both resolve, UUID is stable across renames. Also flags `WV` (forecast) alongside `W` (observed) — useful for a pre-resolution estimate. |
| **IBTrACS ERDDAP** | For the ACE question, 6-hourly named-storm max winds from `erddap.aoml.noaa.gov` is the right structure. My HURDAT2 pointer gives the history but not a queryable interface. |
| **Cboe `VIX_History.csv`** | Official machine-readable daily VIX. Better provenance than Yahoo for closes (though still not intraday — see §3). |
| **Coinbase candles** | `api.exchange.coinbase.com/products/{id}/candles`. Venue-specific intraday highs matter for "at any point in August" crypto wording; CoinGecko aggregation can miss a momentary print. Correct catch. |
| **Census EITS `resconst`** | Housing starts direct from Census rather than the FRED mirror. |
| **LegiScan / Brazil Câmara / Regulations.gov** | CA AB 1921, PL 3481/2026, and agency dockets. All three missing from mine. |
| **RAWG** | Carries a Metacritic field — a partial route to the Halo Campaign Evolved question I had filed as pure scrape. |
| **FlightAware AeroAPI** | The United EWR–TLV flight question. I missed the question entirely. |
| **Bluesky Jetstream** | `wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.like` — the principled way to compute daily unique likers. See §3 for the caveat. |

---

## 2. My registry is right, the guide is wrong — three items

### 2a. `api.weather.gov` cannot serve the Reykjavík eclipse question (hard error)

The guide's routing matrix sends "Reykjavík eclipse visibility" to
"NWS/Open-Meteo/cloud observations." **The NWS API covers US jurisdictions
only.** BIKF (Keflavík) is not in it. Open-Meteo is reanalysis, not the observed
METAR the question needs.

The guide never mentions the Iowa Environmental Mesonet, which is the correct
source and the one that fixes the documented Q44953 failure:

```
https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py
  ?station=BIKF&data=all&tz=UTC&format=onlycomma
  &year1=2026&month1=8&day1=12&year2=2026&month2=8&day2=13
```

Global METAR archive, no key, returns `skyc1`/`skyl1` as CSV, takes the bare
ICAO code — which is exactly the failure mode from last time, where the
`obhistory.php` fetch lost `network=IS__ASOS` and returned the Iowa landing
page. IEM also covers the hottest/coldest-state questions where Ogimet 403s.

**This is the single most consequential difference between the two documents.**

### 2b. IMF PortWatch does have a documented public API

The guide states no stable documented REST endpoint was found and routes to
"the named monitor/download" plus licensed AIS. That is not correct as of now.
PortWatch's own Data & Methodology page carries explicit "Access API" links, and
the FeatureServer is public and unauthenticated:

```
https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services/
  Daily_Chokepoints_Data/FeatureServer/0/query
  ?where=<filter>&outFields=*&returnGeometry=false&f=json
```

Max 1000 records/page, paginate with `resultOffset`. Refreshed Tuesdays 09:00
ET, so expect up to a week of lag on recent dates. This satisfies the guide's
own "documented public API" bar and covers Bab el-Mandeb, Hormuz normalisation,
and the Hormuz "Closed" status question.

### 2c. Artificial Analysis has a documented public Data API

The guide lists AAII under "no dependable public API." Verified otherwise:

```
GET https://artificialanalysis.ai/api/v2/language/models
Header: x-api-key: {key}
```

Documented at `artificialanalysis.ai/data-api/docs`. Free tier via an Insights
Platform account. Returns `artificial_analysis_intelligence_index` per model
plus an index-version field — which matters, because the index is versioned
(currently v4.1.1) and a version bump mid-question changes what "highest score"
means. Covers both AAII questions properly.

---

## 3. Genuine disagreement of principle — not an error either way

The guide excludes undocumented internal endpoints on principle. That is the
right default for **resolution**. For a forecasting pipeline it is too strict as
an **input** policy, because you are predicting what a tracker will display, and
the tracker's own XHR is the same data one layer down.

Affected: OCEARCH tracker JSON, `bsky.jazco.dev/stats`, AAA gas prices,
StatCounter CSV export (`gs.statcounter.com/...&csv=1` — I am moderately but not
fully confident this is still live; verify before relying on it).

Suggested resolution: keep the guide's two-tier split, add a third tier.

- **Tier A — resolution-grade.** Documented, stable, citable.
- **Tier B — forecasting input.** Documented but not the named source.
- **Tier C — fragile input.** Undocumented internal endpoints. Usable, must be
  logged with the retrieval URL and timestamp, must never be cited as the
  resolution source, and must fail loudly rather than silently when the shape
  changes.

Tier C is where your Q45191 failure actually lives: the Ogimet scrape returned
firecrawl status `ok` with a 21-character body containing "Status: 403
Forbidden", the audit logged `scraped-failed=0`, and no retry fired. A Tier C
adapter with a response-shape assertion catches that; a scraper that trusts an
HTTP 200 does not.

Same reasoning applies to Jetstream: it is the correct source for daily unique
likers, but it only works if you have been archiving continuously since before
the question opened. Starting it today does not retroactively give you 31 August.
For a question resolving on a date already past, the jazco endpoint is the only
route, documented or not.

---

## 4. Unresolved factual conflict — verify before coding

**EIA SPR series ID.** I wrote `WCESTUS1`; the guide wrote `WCRSTUS1`. I believe
we are both wrong — `WCESTUS1` is commercial crude excluding SPR, `WCRSTUS1` is
total crude including SPR, and the SPR-only stock series is `WCSSTUS1`. Confirm
against the EIA weekly petroleum status report before wiring this up; the SPR
barrels question is sensitive to exactly this distinction.

The guide's route (`petroleum/sum/sndw/data/`) is more likely correct than mine
(`petroleum/stoc/wstk/data/`) regardless of the series ID.

---

## 5. Things in my registry the guide doesn't cover

Lower confidence than §2 — these are additions, not corrections.

- **`fred/release/dates`** — scheduled release calendar. Worth wiring into the
  temporal-feasibility gate specifically, since "has this print landed yet" is
  currently being inferred from prose. Same argument for
  `congress.gov/.../actions`, which distinguishes committee referral from floor
  passage from enactment — the exact distinction behind the documented
  formal-process-as-resolution-gate conflation.
- **`fred/series` metadata** — `last_updated` and `realtime_start` let you
  detect a revision rather than silently forecasting against a revised vintage.
  The guide raises the vintage problem in §16 but doesn't name the mechanism.
- **OpenRouter `/api/v1/models`** — new models appear within hours of release,
  usually before blog posts are search-indexed. Useful for GPT-6, Grok 4.7,
  Claude Mythos release-detection questions.
- **Wikipedia wikitext via `action=parse`** — the guide writes off polling
  questions as having no API. Wikipedia's opinion-polling pages are maintained
  tables and parse cleanly from wikitext (not HTML). Good for UK Labour 7-poll
  average, generic ballot, Senate races, Putin approval. Not resolution-grade,
  but far better than nothing, and it is where the Tesla robotaxi metro count
  already comes from.

---

## 6. Net position

Adopt the guide as the base document. It is better organised, better sourced,
and its Direct / Strong / Proxy / No-API taxonomy is the right discipline —
particularly the insistence that spot ≠ futures, close ≠ intraday, and
index ≠ contract, which is a live risk across about fifteen of the market
questions.

Merge in from mine: IEM ASOS (§2a — highest priority), IMF PortWatch (§2b),
Artificial Analysis (§2c), the Tier C policy (§3), and the four additions in §5.

Correct in mine: Case-Shiller series, Metaculus endpoint, Launch Library
version, IOM (remove from `no_api`), and the EIA SPR series pending §4.

The guide's implementation order in its §15 is sound and I'd follow it as
written, with one change: pull the IEM adapter forward into step 2 rather than
leaving weather to step 3, because two questions already failed on it.
