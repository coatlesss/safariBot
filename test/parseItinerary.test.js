const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeDate, parseHotelItinerary, parseItinerary } = require("../src/parseItinerary");

test("normalizes common date formats", () => {
  assert.equal(normalizeDate("2026-8-2"), "2026-08-02");
  assert.equal(normalizeDate("Aug 12", "2026"), "2026-08-12");
  assert.equal(normalizeDate("12 August 26"), "2026-08-12");
});

test("parses top-level trip fields and day sections", () => {
  const result = parseItinerary(`
Client: Jane Smith
Trip: Kenya Family Safari
Start: 2026-08-12
End: 2026-08-19

Day 1 - Aug 12 - Nairobi
Accommodation: Hemingways Nairobi
Transfer: Private airport transfer
Activity: Evening at leisure
Meals: Dinner

Day 2 - Aug 13 - Amboseli
Flight: Wilson to Amboseli
Lodge: Tortilis Camp
Activity: Afternoon game drive
`);

  assert.equal(result.clientName, "Jane Smith");
  assert.equal(result.tripTitle, "Kenya Family Safari");
  assert.equal(result.startDate, "2026-08-12");
  assert.equal(result.endDate, "2026-08-19");
  assert.equal(result.days.length, 2);
  assert.equal(result.days[0].date, "2026-08-12");
  assert.equal(result.days[0].location, "Nairobi");
  assert.equal(result.days[0].accommodation, "Hemingways Nairobi");
  assert.deepEqual(result.days[0].transfers, ["Private airport transfer"]);
  assert.deepEqual(result.days[1].flights, ["Wilson to Amboseli"]);
});

test("parses hotel-only lists without day headings", () => {
  const result = parseHotelItinerary(`
Client: John Example
Trip: Tanzania Hotels
Hotel: Arusha Coffee Lodge
Lodge: Gibbs Farm
Serengeti Safari Camp
`);

  assert.equal(result.clientName, "John Example");
  assert.equal(result.tripTitle, "Tanzania Hotels");
  assert.equal(result.days.length, 3);
  assert.equal(result.days[0].accommodation, "Arusha Coffee Lodge");
  assert.equal(result.days[1].accommodation, "Gibbs Farm");
  assert.equal(result.days[2].accommodation, "Serengeti Safari Camp");
  assert.deepEqual(result.days[0].activities, []);
});
