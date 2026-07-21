const MONTHS = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12"
};

function normalizeDate(value, fallbackYear) {
  const text = value.trim().replace(/,/g, "");

  const iso = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;

  // Dot-separated dates are always day.month.year (European convention), unlike
  // the slash/dash form below which is treated as month-first.
  const dot = text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/);
  if (dot) {
    const year = expandYear(dot[3]);
    if (!year) return text;
    return `${year}-${dot[2].padStart(2, "0")}-${dot[1].padStart(2, "0")}`;
  }

  const slash = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (slash) {
    const year = slash[3] ? expandYear(slash[3]) : fallbackYear;
    if (!year) return text;
    return `${year}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
  }

  const monthFirst = text.match(/^([A-Za-z]+)\s+(\d{1,2})(?:\s+(\d{2,4}))?$/);
  if (monthFirst && MONTHS[monthFirst[1].toLowerCase()]) {
    const year = monthFirst[3] ? expandYear(monthFirst[3]) : fallbackYear;
    if (!year) return text;
    return `${year}-${MONTHS[monthFirst[1].toLowerCase()]}-${monthFirst[2].padStart(2, "0")}`;
  }

  const dayFirst = text.match(/^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{2,4}))?$/);
  if (dayFirst && MONTHS[dayFirst[2].toLowerCase()]) {
    const year = dayFirst[3] ? expandYear(dayFirst[3]) : fallbackYear;
    if (!year) return text;
    return `${year}-${MONTHS[dayFirst[2].toLowerCase()]}-${dayFirst[1].padStart(2, "0")}`;
  }

  return text;
}

function expandYear(value) {
  if (!value) return "";
  if (value.length === 2) return Number(value) > 70 ? `19${value}` : `20${value}`;
  return value;
}

function looksLikeDate(text, fallbackYear) {
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizeDate(text, fallbackYear));
}

// Parses "Hotel A [Room X] or Hotel B [Room Y, Room Z]" into per-hotel option
// objects, matching the Safari Portal's own "or"-separated multi-mention
// syntax for offering clients a choice of accommodation. Brackets are optional
// per hotel and list which specific room(s) to select for that option.
function parseAccommodationOptions(value) {
  return value.split(/\s+or\s+/i).map((piece) => piece.trim()).filter(Boolean).map((piece) => {
    const match = piece.match(/^(.*?)(?:\s*\[([^\]]*)\])?$/);
    const name = (match?.[1] || piece).trim();
    const rooms = match?.[2] ? match[2].split(",").map((room) => room.trim()).filter(Boolean) : [];
    return { name, rooms };
  });
}

function pushValue(target, field, value) {
  const trimmed = value.trim();
  if (!trimmed) return;
  if (Array.isArray(target[field])) {
    target[field].push(trimmed);
  } else {
    target[field] = trimmed;
  }
}

function emptyDay(number = null) {
  return {
    number,
    date: "",
    location: "",
    accommodation: "",
    activities: [],
    transfers: [],
    flights: [],
    meals: [],
    notes: []
  };
}

// Parses a "Day N" or "Day N-M" heading into one day object per covered day,
// so a single Accommodation/Location line below can apply to a whole multi-night
// stay instead of the employee repeating a day block per night.
function parseHeading(line, fallbackYear) {
  const match = line.match(/^day\s+(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:[-:|]\s*)?(.*)$/i);
  if (!match) return null;

  const startNumber = Number(match[1]);
  const endNumber = match[2] ? Number(match[2]) : startNumber;
  const rest = match[3].trim();

  let date = "";
  let location = "";
  if (rest) {
    const pieces = rest.split(/\s+-\s+|\s+\|\s+/).map((piece) => piece.trim()).filter(Boolean);
    if (pieces.length > 1) {
      if (pieces[0]) date = normalizeDate(pieces[0], fallbackYear);
      location = pieces.slice(1).join(" - ");
    } else if (pieces[0]) {
      // A single piece could be either a date ("Day 1: Aug 12") or just a
      // location ("Day 1-2: Osaka") - only treat it as a date if it actually
      // resolves to one, so a location-only heading isn't mangled into a
      // garbage date with an empty location.
      if (looksLikeDate(pieces[0], fallbackYear)) {
        date = normalizeDate(pieces[0], fallbackYear);
      } else {
        location = pieces[0];
      }
    }
  }

  const days = [];
  for (let number = startNumber; number <= endNumber; number += 1) {
    const day = emptyDay(number);
    day.location = location;
    if (date) day.date = number === startNumber ? date : addDays(date, number - startNumber);
    days.push(day);
  }

  return days;
}

function isOptedOut(value) {
  return /^(no|false|off|skip|none)$/i.test(value.trim());
}

function parseItinerary(text) {
  const result = {
    clientName: "",
    tripTitle: "",
    startDate: "",
    endDate: "",
    includeArrival: true,
    includeDeparture: true,
    summaryNotes: [],
    days: []
  };

  let currentDayGroup = null;
  let fallbackYear = "";
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const topLevel = line.match(/^(client|traveler|traveller|guest|trip|title|start|start date|end|end date|arrival|departure)\s*:\s*(.+)$/i);
    if (topLevel && !currentDayGroup) {
      const key = topLevel[1].toLowerCase();
      const value = topLevel[2].trim();
      if (["client", "traveler", "traveller", "guest"].includes(key)) result.clientName = value;
      if (["trip", "title"].includes(key)) result.tripTitle = value;
      if (["start", "start date"].includes(key)) {
        result.startDate = normalizeDate(value, fallbackYear);
        fallbackYear = result.startDate.match(/^(\d{4})-/)?.[1] || fallbackYear;
      }
      if (["end", "end date"].includes(key)) result.endDate = normalizeDate(value, fallbackYear);
      if (key === "arrival" && isOptedOut(value)) result.includeArrival = false;
      if (key === "departure" && isOptedOut(value)) result.includeDeparture = false;
      continue;
    }

    const heading = parseHeading(line, fallbackYear);
    if (heading) {
      currentDayGroup = heading;
      result.days.push(...currentDayGroup);
      continue;
    }

    const field = line.match(/^(accommodation|hotel|lodge|camp|activity|activities|transfer|transfers|flight|flights|meal|meals|note|notes)\s*:\s*(.+)$/i);
    if (field) {
      if (!currentDayGroup) {
        pushValue(result, "summaryNotes", line);
        continue;
      }

      const label = field[1].toLowerCase();
      const value = field[2];
      const accommodationOptions = ["accommodation", "hotel", "lodge", "camp"].includes(label)
        ? parseAccommodationOptions(value)
        : null;
      for (const currentDay of currentDayGroup) {
        if (accommodationOptions) {
          pushValue(currentDay, "accommodation", accommodationOptions[0]?.name || value);
          if (accommodationOptions.length > 1 || accommodationOptions.some((option) => option.rooms.length)) {
            currentDay.accommodationOptions = accommodationOptions;
          }
        }
        if (["activity", "activities"].includes(label)) pushValue(currentDay, "activities", value);
        if (["transfer", "transfers"].includes(label)) pushValue(currentDay, "transfers", value);
        if (["flight", "flights"].includes(label)) pushValue(currentDay, "flights", value);
        if (["meal", "meals"].includes(label)) pushValue(currentDay, "meals", value);
        if (["note", "notes"].includes(label)) pushValue(currentDay, "notes", value);
      }
      continue;
    }

    if (currentDayGroup) {
      for (const currentDay of currentDayGroup) currentDay.notes.push(line);
    } else {
      result.summaryNotes.push(line);
    }
  }

  if (!result.startDate) result.startDate = result.days.find((day) => day.date)?.date || "";
  if (!result.endDate) result.endDate = [...result.days].reverse().find((day) => day.date)?.date || "";

  return result;
}

// A cell that spans several lines (a Word "Shift+Enter" soft break inside one
// table cell) shows up as consecutive non-blank lines; a blank line marks the
// boundary between cells. This turns the raw lines of one day's block into
// that ordered list of cell contents.
function splitIntoRuns(lines) {
  const runs = [];
  let current = [];
  for (const line of lines) {
    if (line.trim() === "") {
      if (current.length) {
        runs.push(current.join(" ").trim());
        current = [];
      }
    } else {
      current.push(line.trim());
    }
  }
  if (current.length) runs.push(current.join(" ").trim());
  return runs;
}

// A Route cell like "Fukuoka - Nagasaki" (or "Kuju Mountains - Fukuoka -
// Miyajima") describes a transfer day, not a place of its own - the traveler
// only actually stays overnight at the last leg, so that's the day's real
// location.
function overnightLocation(routeText) {
  const legs = routeText.split(/\s+-\s+/).map((leg) => leg.trim()).filter(Boolean);
  const last = legs.length ? legs[legs.length - 1] : routeText.trim();
  // A route cell that itself spans two soft-broken lines (e.g. a flight leg
  // followed by its arrival city repeated on its own line) joins with a
  // space rather than a blank-line boundary, which can echo the same word
  // twice ("... Tokyo" + "Tokyo" -> "Tokyo Tokyo").
  return last.replace(/\b(\S+)(\s+\1)+\b/gi, "$1");
}

function looksLikeVerticalHotelTable(lines) {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    return trimmed.toLowerCase() === "day";
  }
  return false;
}

// Parses a "one cell per line" table paste - copying a Word/Excel itinerary
// table into chat turns every cell into its own paragraph, with a header row
// of Day / Date / Route [/ Program / Hotel(s) / Rooms / Meals] naming the
// columns. Cells after Route can't be told apart reliably (an empty cell and
// an ordinary paragraph break both collapse to one blank line, and a single
// cell can itself hold several paragraphs), so this only pulls out what's
// unambiguous - which day stays where, and for how long - and leaves the
// hotel as a placeholder for someone to fill in by hand afterward, the same
// way the plain tab-separated table format already does.
function parseVerticalHotelTable(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (!looksLikeVerticalHotelTable(lines)) return null;

  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  i += 1; // the "Day" header line itself

  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i >= lines.length) break;
    if (/^\d+$/.test(lines[i].trim())) break;
    i += 1; // remaining header cells (Date, Route, Program, Hotel(s), ...)
  }

  const days = [];

  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i >= lines.length) break;
    const cell = lines[i].trim();
    if (!/^\d+$/.test(cell)) {
      i += 1;
      continue;
    }
    const dayNumber = Number(cell);
    i += 1;

    // Real cell content (dates, routes, hotel names) never appears as a bare
    // digit-only line, so the next one always marks the start of the next
    // row - this also keeps things from breaking if a paste gets duplicated
    // or restarts partway through, instead of one row swallowing the rest.
    const blockLines = [];
    while (i < lines.length) {
      if (/^\d+$/.test(lines[i].trim())) break;
      blockLines.push(lines[i]);
      i += 1;
    }

    const runs = splitIntoRuns(blockLines);
    const dateRun = runs[0] || "";
    const location = runs[1] ? overnightLocation(runs[1]) : "";

    const day = emptyDay(dayNumber);
    day.date = dateRun ? normalizeDate(dateRun, "") : "";
    day.location = location;
    if (location && !isNonHotelLocation(location)) day.accommodation = placeholderHotel(location);
    days.push(day);
  }

  return days;
}

function parseHotelItinerary(text, options = {}) {
  const itinerary = parseItinerary(text);
  const selectedStartDate = normalizeSelectedStartDate(options.startDate);

  const verticalDays = parseVerticalHotelTable(text);
  if (verticalDays && verticalDays.length) {
    itinerary.summaryNotes = [];
    itinerary.days = verticalDays
      .filter((day) => Boolean(day.accommodation))
      .map((day) => ({
        number: day.number,
        date: day.date,
        location: day.location,
        accommodation: day.accommodation,
        activities: [],
        transfers: [],
        flights: [],
        meals: [],
        notes: []
      }));
    itinerary.startDate = itinerary.days[0]?.date || selectedStartDate || "";
    itinerary.endDate = itinerary.days[itinerary.days.length - 1]?.date || itinerary.startDate || "";
    return itinerary;
  }

  const tableDays = parseHotelTable(text, itinerary);
  if (tableDays.length) {
    itinerary.summaryNotes = [];
    itinerary.days = assignDates(tableDays, itinerary.startDate || selectedStartDate);
    itinerary.startDate = itinerary.startDate || selectedStartDate || itinerary.days[0]?.date || "";
    itinerary.endDate = itinerary.days[itinerary.days.length - 1]?.date || itinerary.endDate || "";
    return itinerary;
  }

  itinerary.summaryNotes = [];
  itinerary.days = itinerary.days
    .filter((day) => Boolean(day.accommodation))
    .map((day, index) => ({
      number: day.number || index + 1,
      date: day.date,
      location: day.location,
      accommodation: day.accommodation,
      activities: [],
      transfers: [],
      flights: day.flights || [],
      meals: [],
      notes: [],
      ...(day.accommodationOptions ? { accommodationOptions: day.accommodationOptions } : {})
    }));

  if (itinerary.days.length) {
    itinerary.days = assignDates(itinerary.days, itinerary.startDate || selectedStartDate);
    itinerary.startDate = itinerary.startDate || selectedStartDate || itinerary.days[0].date || "";
    itinerary.endDate = itinerary.days[itinerary.days.length - 1].date || itinerary.endDate || "";
    return itinerary;
  }

  const lines = text.replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const topLevel = line.match(/^(client|traveler|traveller|guest|trip|title|start|start date|end|end date)\s*:\s*(.+)$/i);
    if (topLevel) continue;

    const hotel = line.match(/^(?:hotel|accommodation|lodge|camp)\s*:\s*(.+)$/i);
    const value = hotel ? hotel[1].trim() : line;
    if (!value) continue;

    itinerary.days.push({
      ...emptyDay(itinerary.days.length + 1),
      accommodation: value
    });
  }

  itinerary.days = assignDates(itinerary.days, itinerary.startDate || selectedStartDate);
  itinerary.startDate = itinerary.startDate || selectedStartDate || itinerary.days[0]?.date || "";
  itinerary.endDate = itinerary.days[itinerary.days.length - 1]?.date || itinerary.endDate || "";

  return itinerary;
}

function parseHotelTable(text, baseItinerary) {
  const days = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    if (/^(client|traveler|traveller|guest|trip|title|start|start date|end|end date)\s*:/i.test(line)) {
      continue;
    }

    const row = parseTableRow(line);
    if (!row) continue;

    for (const number of row.dayNumbers) {
      days.push({
        ...emptyDay(number),
        location: row.location,
        accommodation: placeholderHotel(row.location)
      });
    }
  }

  if (days.length && !baseItinerary.endDate) {
    baseItinerary.endDate = days[days.length - 1].date || "";
  }

  return days;
}

// Only a genuine spreadsheet-style paste (columns separated by a tab or
// multiple spaces) should be treated as a hotel table row. A single space
// after the day number also matches free-text headings like "Day 1-4 -
// Fukuoka" that are meant to be parsed as a "Day N-M" heading followed by
// its own "Accommodation:" line, so requiring the wider gap here keeps
// those two input styles from being confused with each other.
function parseTableRow(line) {
  const match = line.match(/^(?:day\s*)?(\d+)(?:\s*[-–]\s*(\d+))?(?:\t+|[ ]{2,})(.+)$/i);
  if (!match) return null;

  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : start;
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return null;

  const cells = match[3].split(/\t+|\s{2,}/).map((cell) => cell.trim()).filter(Boolean);
  const location = cells[0] || "";
  if (!location || isNonHotelLocation(location)) return null;

  return {
    dayNumbers: Array.from({ length: end - start + 1 }, (_, index) => start + index),
    location
  };
}

function isNonHotelLocation(value) {
  return /^(flight|flight back|fly home|return flight|departure|depart|home)$/i.test(value.trim());
}

function placeholderHotel(location) {
  return `Hotel TBD - ${location}`;
}

function normalizeSelectedStartDate(value) {
  if (!value) return "";
  const normalized = normalizeDate(String(value), "");
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function assignDates(days, startDate) {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return days;

  return days.map((day) => ({
    ...day,
    date: day.date || addDays(startDate, Math.max(0, (day.number || 1) - 1))
  }));
}

function addDays(startDate, offset) {
  const [year, month, day] = startDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

module.exports = {
  normalizeDate,
  parseHotelItinerary,
  parseItinerary
};
