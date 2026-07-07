const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeDate, parseHotelItinerary, parseItinerary } = require("../src/parseItinerary");
const { buildHotelTimelinePlan } = require("../src/portalBuilder");

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

test("applies one Accommodation line to every day in a 'Day N-M' range heading", () => {
  const result = parseItinerary(`
Client: Jane Smith
Trip: Japan Hotels and Transfers
Start: 2026-08-12

Day 1-2: Aug 12 | Osaka
Accommodation: Zentis Osaka

Day 3: Aug 14 | Kyoto
Accommodation: Noku Kyoto
`);

  assert.equal(result.days.length, 3);
  assert.equal(result.days[0].number, 1);
  assert.equal(result.days[0].date, "2026-08-12");
  assert.equal(result.days[0].location, "Osaka");
  assert.equal(result.days[0].accommodation, "Zentis Osaka");
  assert.equal(result.days[1].number, 2);
  assert.equal(result.days[1].date, "2026-08-13");
  assert.equal(result.days[1].location, "Osaka");
  assert.equal(result.days[1].accommodation, "Zentis Osaka");
  assert.equal(result.days[2].number, 3);
  assert.equal(result.days[2].date, "2026-08-14");
  assert.equal(result.days[2].accommodation, "Noku Kyoto");
});

test("treats a single-piece heading as a location, not a garbled date, when it isn't date-shaped", () => {
  const result = parseItinerary(`
Start: 2026-08-12

Day 1-2: Osaka
Accommodation: Zentis Osaka

Day 3: Aug 14
Accommodation: Noku Kyoto
`);

  assert.equal(result.days.length, 3);
  assert.equal(result.days[0].location, "Osaka");
  assert.equal(result.days[0].date, "");
  assert.equal(result.days[0].accommodation, "Zentis Osaka");
  assert.equal(result.days[1].location, "Osaka");
  assert.equal(result.days[2].location, "");
  assert.equal(result.days[2].date, "2026-08-14");
  assert.equal(result.days[2].accommodation, "Noku Kyoto");
});

test("parses 'Hotel A [Rooms] or Hotel B [Rooms]' into accommodation options", () => {
  const result = parseItinerary(`
Day 1-2: Aug 12 | Osaka
Accommodation: Zentis Osaka or Noku Kyoto [House Room King, Noku Studio]

Day 3: Aug 14 | Kyoto
Accommodation: Plain Hotel No Options
`);

  assert.equal(result.days[0].accommodation, "Zentis Osaka");
  assert.deepEqual(result.days[0].accommodationOptions, [
    { name: "Zentis Osaka", rooms: [] },
    { name: "Noku Kyoto", rooms: ["House Room King", "Noku Studio"] }
  ]);
  // The heading covers days 1-2, so the option list applies to both.
  assert.deepEqual(result.days[1].accommodationOptions, result.days[0].accommodationOptions);
  // A plain single-hotel entry should not grow an accommodationOptions field.
  assert.equal(result.days[2].accommodation, "Plain Hotel No Options");
  assert.equal(result.days[2].accommodationOptions, undefined);
});

test("parses tabular day and location rows as hotel placeholders", () => {
  const result = parseHotelItinerary(`
Day 1-5	Heda-Ito	Own arrangement
6	Kyoto	Evening shinkansen Atami-Kyoto
7	Kyoto	Guided tour Kyoto
8	Kyoto	Free day
9	Okayama	Morning free time Kyoto; evening go to Okayama
10	Naoshima	Visit Naoshima
11	Okayama	Visit Naoshima
12	Tokyo	Morning visit Okayama - evening train to Tokyo
13	Tokyo	Guided tour old Tokyo
14	Tokyo	Sumo experience/practice & free day
15	Tokyo	Free day
16	Flight back
`);

  assert.equal(result.days.length, 15);
  assert.equal(result.days[0].number, 1);
  assert.equal(result.days[0].location, "Heda-Ito");
  assert.equal(result.days[0].accommodation, "Hotel TBD - Heda-Ito");
  assert.equal(result.days[4].number, 5);
  assert.equal(result.days[5].number, 6);
  assert.equal(result.days[5].accommodation, "Hotel TBD - Kyoto");
  assert.equal(result.days[14].number, 15);
  assert.equal(result.days[14].accommodation, "Hotel TBD - Tokyo");
});

test("assigns hotel dates from a selected start date", () => {
  const result = parseHotelItinerary(`
Day 1-2	Heda-Ito	Own arrangement
3	Kyoto	Evening shinkansen Atami-Kyoto
4	Flight back
`, { startDate: "2026-04-10" });

  assert.equal(result.startDate, "2026-04-10");
  assert.equal(result.endDate, "2026-04-12");
  assert.equal(result.days.length, 3);
  assert.equal(result.days[0].date, "2026-04-10");
  assert.equal(result.days[1].date, "2026-04-11");
  assert.equal(result.days[2].date, "2026-04-12");
  assert.equal(result.days[2].accommodation, "Hotel TBD - Kyoto");
});

test("plans repeated Japan hotel and transfer rows for longer routes", () => {
  const result = parseHotelItinerary(`
Day 1	Osaka	Arrival and free evening
2	Kyoto	Shinkansen Osaka-Kyoto
3-4	Hakone	Ryokan stay and open-air baths
5	Tokyo	Train to Tokyo
6	Hiroshima	Shinkansen to Hiroshima
7	Flight back
`, { startDate: "2026-08-12" });

  const plan = buildHotelTimelinePlan(result.days);

  assert.equal(result.days.length, 6);
  assert.deepEqual(plan.map((item) => item.hotelRowIndex), [0, 2, 4, 6, 8]);
  assert.deepEqual(plan.map((item) => item.transferRowIndex), [1, 3, 5, 7, null]);
  assert.deepEqual(plan.map((item) => item.stay.firstDay.location), ["Osaka", "Kyoto", "Hakone", "Tokyo", "Hiroshima"]);
  assert.equal(plan[0].transferTag, "@TransferOsakatoKyotoOsakaKyotoNormal");
  assert.equal(plan[1].transferTag, "@TransferKyototoHakoneKyotoHakoneNormal");
  assert.equal(plan[2].transferTag, "@TransferHakonetoTokyoHakoneTokyoNormal");
  assert.equal(plan[3].transferTag, "@TransferTokyotoHiroshimaTokyoHiroshimaNormal");
  assert.equal(plan[4].transferTag, "");
});
