import { z } from "zod";
import { defineAdapter } from "../types.ts";
import { capRows, csvToObjects, getText, now, ShapeError } from "../http.ts";

/**
 * Iowa Environmental Mesonet — global ASOS/METAR archive.
 *
 * `api-registry-crossref.md` §2a calls this "the single most consequential
 * difference between the two documents", and it is the only adapter here that
 * exists to fix a specific documented failure (Q44953).
 *
 * The argument, in short: the companion guide routed observed-weather questions
 * to `api.weather.gov`, which covers US jurisdictions ONLY — BIKF (Keflavík) is
 * not in it — and to Open-Meteo, which is reanalysis rather than the observed
 * METAR such questions actually turn on. IEM is a global METAR archive, needs no
 * key, takes a bare ICAO code, and returns the sky-cover columns directly.
 *
 * Tier A: a METAR is the observation of record.
 */

const params = z.object({
  station: z
    .string()
    .regex(/^[A-Za-z0-9]{3,4}$/)
    .describe(
      'Bare ICAO airport code, e.g. "BIKF" for Keflavík, "KJFK" for JFK. ' +
        "No network prefix — IEM resolves the network itself.",
    ),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("First day to include, YYYY-MM-DD, UTC."),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Last day, YYYY-MM-DD, UTC. Same as startDate for a single day."),
});

/**
 * Requested explicitly rather than `data=all`.
 *
 * `all` returns about thirty columns, most of them irrelevant, and a day of
 * hourly observations then costs more of the turn's character budget than the
 * question needs. skyc1/skyl1 are the cloud layers §2a names; metar is the raw
 * coded observation, which is what a careful reader will want to check.
 */
const FIELDS = [
  "tmpf",
  "dwpf",
  "relh",
  "drct",
  "sknt",
  "p01i",
  "vsby",
  "skyc1",
  "skyc2",
  "skyc3",
  "skyl1",
  "metar",
];

export const iemAsos = defineAdapter({
  id: "iem_asos",
  name: "Iowa Environmental Mesonet (ASOS)",
  tier: "A",
  domain: "weather",
  answers:
    "OBSERVED surface weather at any airport worldwide: temperature, wind, " +
    "visibility, precipitation and cloud cover, from the METAR record. " +
    "Resolution-grade for 'was it clear/raining/above N degrees at PLACE on " +
    "DATE'. Works outside the United States, which api.weather.gov does not. " +
    "Do NOT use it for FORECASTS — this is what was measured, not what is " +
    "expected — and do NOT use it for city-wide or regional averages.",
  keywords: [
    "weather", "temperature", "rain", "snow", "wind", "cloud", "clouds",
    "cloudy", "clear", "sky", "visibility", "observed", "metar", "airport",
    "station", "precipitation", "humidity", "fog", "overcast", "eclipse",
    "hottest", "coldest", "degrees", "celsius", "fahrenheit", "conditions",
  ],
  paramsSchema: params,
  paramsHelp:
    "All three fields are required. Keep the range short — one or two days " +
    "returns hourly observations; a month will be truncated.",

  async run(input, signal) {
    const [y1, m1, d1] = input.startDate.split("-");
    const [y2, m2, d2] = input.endDate.split("-");

    const url = new URL("https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py");
    url.searchParams.set("station", input.station.toUpperCase());
    for (const field of FIELDS) url.searchParams.append("data", field);
    url.searchParams.set("tz", "UTC");
    url.searchParams.set("format", "onlycomma");
    url.searchParams.set("missing", "M");
    url.searchParams.set("trace", "T");
    url.searchParams.set("year1", y1);
    url.searchParams.set("month1", String(Number(m1)));
    url.searchParams.set("day1", String(Number(d1)));
    url.searchParams.set("year2", y2);
    url.searchParams.set("month2", String(Number(m2)));
    url.searchParams.set("day2", String(Number(d2)));

    const href = url.toString();
    const text = await getText(href, { signal, context: "IEM ASOS" });

    /*
     * The exact §2a failure, guarded.
     *
     * Last time this endpoint was called with a lost parameter it returned the
     * Iowa landing page under a 200, and the pipeline recorded a successful
     * fetch of nothing. A valid CSV always begins with the station column, so
     * anything that does not is an error however healthy its status line looked.
     */
    if (!text.startsWith("station,")) {
      throw new ShapeError(
        "IEM ASOS",
        "a CSV beginning with a station column",
        text.slice(0, 200),
      );
    }

    const observations = csvToObjects(text);
    const { rows, truncated } = capRows(observations);

    return {
      tier: "A" as const,
      url: href,
      retrievedAt: now(),
      rows,
      truncated,
      note:
        `${observations.length} observations in range, times in UTC. ` +
        "M means missing, T means a trace. Sky cover uses METAR codes: CLR/SKC " +
        "clear, FEW, SCT scattered, BKN broken, OVC overcast; skyl1 is the base " +
        "height of the first layer in feet." +
        (truncated
          ? " Truncated — narrow the date range to see the rest."
          : ""),
    };
  },
});
