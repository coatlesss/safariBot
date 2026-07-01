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

function parseHeading(line, fallbackYear) {
  const match = line.match(/^day\s+(\d+)\s*(?:[-:|]\s*)?(.*)$/i);
  if (!match) return null;

  const day = emptyDay(Number(match[1]));
  const rest = match[2].trim();
  if (!rest) return day;

  const pieces = rest.split(/\s+-\s+|\s+\|\s+/).map((piece) => piece.trim()).filter(Boolean);
  if (pieces[0]) day.date = normalizeDate(pieces[0], fallbackYear);
  if (pieces.length > 1) day.location = pieces.slice(1).join(" - ");

  return day;
}

function parseItinerary(text) {
  const result = {
    clientName: "",
    tripTitle: "",
    startDate: "",
    endDate: "",
    summaryNotes: [],
    days: []
  };

  let currentDay = null;
  let fallbackYear = "";
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const topLevel = line.match(/^(client|traveler|traveller|guest|trip|title|start|start date|end|end date)\s*:\s*(.+)$/i);
    if (topLevel && !currentDay) {
      const key = topLevel[1].toLowerCase();
      const value = topLevel[2].trim();
      if (["client", "traveler", "traveller", "guest"].includes(key)) result.clientName = value;
      if (["trip", "title"].includes(key)) result.tripTitle = value;
      if (["start", "start date"].includes(key)) {
        result.startDate = normalizeDate(value, fallbackYear);
        fallbackYear = result.startDate.match(/^(\d{4})-/)?.[1] || fallbackYear;
      }
      if (["end", "end date"].includes(key)) result.endDate = normalizeDate(value, fallbackYear);
      continue;
    }

    const heading = parseHeading(line, fallbackYear);
    if (heading) {
      currentDay = heading;
      result.days.push(currentDay);
      continue;
    }

    const field = line.match(/^(accommodation|hotel|lodge|camp|activity|activities|transfer|transfers|flight|flights|meal|meals|note|notes)\s*:\s*(.+)$/i);
    if (field) {
      if (!currentDay) {
        pushValue(result, "summaryNotes", line);
        continue;
      }

      const label = field[1].toLowerCase();
      const value = field[2];
      if (["accommodation", "hotel", "lodge", "camp"].includes(label)) pushValue(currentDay, "accommodation", value);
      if (["activity", "activities"].includes(label)) pushValue(currentDay, "activities", value);
      if (["transfer", "transfers"].includes(label)) pushValue(currentDay, "transfers", value);
      if (["flight", "flights"].includes(label)) pushValue(currentDay, "flights", value);
      if (["meal", "meals"].includes(label)) pushValue(currentDay, "meals", value);
      if (["note", "notes"].includes(label)) pushValue(currentDay, "notes", value);
      continue;
    }

    if (currentDay) {
      currentDay.notes.push(line);
    } else {
      result.summaryNotes.push(line);
    }
  }

  if (!result.startDate) result.startDate = result.days.find((day) => day.date)?.date || "";
  if (!result.endDate) result.endDate = [...result.days].reverse().find((day) => day.date)?.date || "";

  return result;
}

module.exports = {
  normalizeDate,
  parseItinerary
};
