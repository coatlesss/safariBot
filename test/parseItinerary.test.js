const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeDate, parseHotelItinerary, parseItinerary } = require("../src/parseItinerary");
const { buildHotelTimelinePlan, getHotelStays } = require("../src/portalBuilder");

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

test("keeps 'Day N-M - Location' / Accommodation: pairs from being swallowed as table rows", () => {
  // A single space after the day range ("Day 1-4 - Fukuoka") looks similar to a
  // tab-separated table row, but it's actually a heading for the following
  // "Accommodation:" line. If parseHotelTable mistakes it for tabular input,
  // it only picks up whichever headings happen to match and drops every
  // other destination in the itinerary.
  const result = parseHotelItinerary(`
Day 1-4 - Fukuoka
Accommodation: Eigen verblijf

Day 4-6 Nagasaki
Accommodation: Indigo Nagasaki Glover Street

Day 6-8: Kumamoto
Accommodation: Tudzura
`);

  // Day 1-4 (4 entries) + Day 4-6 (3 entries) + Day 6-8 (3 entries) = 10; the
  // shared transition days (4 and 6) each appear twice, once for the stay
  // that's ending and once for the stay that's starting.
  assert.equal(result.days.length, 10);
  assert.equal(result.days[0].location, "Fukuoka");
  assert.equal(result.days[0].accommodation, "Eigen verblijf");
  assert.equal(result.days[4].location, "Nagasaki");
  assert.equal(result.days[4].accommodation, "Indigo Nagasaki Glover Street");
  assert.equal(result.days[9].location, "Kumamoto");
  assert.equal(result.days[9].accommodation, "Tudzura");
});

test("parses a 'one cell per line' vertical table paste for location and length of stay, leaving the hotel as a placeholder", () => {
  // Copying a Word/Excel itinerary table into chat turns each cell into its
  // own paragraph, so every value lands on its own line with blank lines as
  // separators instead of tabs. Everything past Route (Program, Hotel,
  // Rooms, Meals, ...) can't be told apart reliably from blank-line counts
  // alone, so only Day/Date/Route are trusted; the accommodation is left as
  // a "Hotel TBD - <location>" placeholder for someone to fill in by hand,
  // same as the plain tab-separated table format already does.
  const result = parseHotelItinerary(`
Day

Date

Route I

Program (activities)

Hotels


1

09.10.26

Fukuoka

Eigen verblijf



2

10.10.26

Fukuoka - Nagasaki

IC-card 2,000 yen
Pick-up rental car

Indigo Nagasaki Glover Street

3

11.10.26




4

12.10.26

Nagasaki

Indigo Nagasaki Glover Street
`);

  assert.equal(result.days.length, 3);
  assert.equal(result.days[0].number, 1);
  assert.equal(result.days[0].date, "2026-10-09");
  assert.equal(result.days[0].location, "Fukuoka");
  assert.equal(result.days[0].accommodation, "Hotel TBD - Fukuoka");
  // A "Fukuoka - Nagasaki" route is a transfer day, not a place of its own -
  // the traveler only stays overnight at the last leg (Nagasaki).
  assert.equal(result.days[1].location, "Nagasaki");
  assert.equal(result.days[1].accommodation, "Hotel TBD - Nagasaki");
  // Day 3 has a blank Route/Program/Hotel cell (a gap in the source table)
  // so it's dropped, same as any other format's accommodation-less days.
  assert.equal(result.days[2].number, 4);
  assert.equal(result.days[2].location, "Nagasaki");
  assert.equal(result.startDate, "2026-10-09");
  assert.equal(result.endDate, "2026-10-12");
});

test("collapses a multi-leg vertical-table route to its last leg so it merges with the destination's stay", () => {
  const result = parseHotelItinerary(`
Day

Date

Route

Program (activities)

Hotel

1

22.10.26

Kuju Mountains - Fukuoka - Miyajima

Drop-off rental car

Miyajima Kinsuikan

2

23.10.26

Miyajima

Free day

Miyajima Kinsuikan
`);

  assert.equal(result.days.length, 2);
  assert.equal(result.days[0].location, "Miyajima");
  assert.equal(result.days[1].location, "Miyajima");

  const stays = getHotelStays(result.days);
  assert.equal(stays.length, 1);
  assert.equal(stays[0].startDate, "2026-10-22");
  assert.equal(stays[0].endDate, "2026-10-23");
});

test("groups consecutive same-location vertical-table days into one stay, to read off nights per location", () => {
  const result = parseHotelItinerary(`
Day

Date

Route

Program (activities)

Hotel

Rooms

Meals

1

06.04.27

Zao Onsen

Bus Yamagata - Zao Onsen

Shinzanso Takamiya

Maisonette-Sansui

HB

2

07.04.27

Zao Onsen

Free day

Shinzanso Takamiya

Maisonette-Sansui

HB

3

08.04.27

Sendai

Bus Zao Onsen - Sendai

Some Sendai Hotel

Twin Room

BB
`);

  assert.equal(result.days.length, 3);
  assert.equal(result.days[0].location, "Zao Onsen");
  assert.equal(result.days[1].location, "Zao Onsen");
  assert.equal(result.days[2].location, "Sendai");

  const stays = getHotelStays(result.days);
  assert.equal(stays.length, 2);
  assert.equal(stays[0].firstDay.location, "Zao Onsen");
  assert.equal(stays[0].startDate, "2027-04-06");
  assert.equal(stays[0].endDate, "2027-04-07");
  assert.equal(stays[1].firstDay.location, "Sendai");
  assert.equal(stays[1].startDate, "2027-04-08");
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

test("prefers pasted itinerary dates over a previously selected start date", () => {
  const result = parseHotelItinerary(`
Start: 2026-08-12
End: 2026-08-19

Day 1-2	Osaka	Arrival and free evening
3	Kyoto	Shinkansen Osaka-Kyoto
4	Flight back
`, { startDate: "2026-04-10" });

  assert.equal(result.startDate, "2026-08-12");
  assert.equal(result.endDate, "2026-08-14");
  assert.equal(result.days[0].date, "2026-08-12");
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

  const plan = buildHotelTimelinePlan(result.days, { includeArrival: false, includeDeparture: false });

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

test("falls back to a generic @transfer tag when a stay's location can't be resolved", () => {
  // A manually added stay (e.g. via the Hotel Setup "+ Add hotel stay"
  // button) can start out with no location at all - the transfer to/from it
  // shouldn't just be silently skipped, it should still get a placeholder
  // tag that can be corrected by hand.
  const days = [
    { number: 1, date: "2026-08-12", location: "Osaka", accommodation: "Zentis Osaka" },
    { number: 2, date: "2026-08-13", location: "", accommodation: "New Hotel" }
  ];

  const plan = buildHotelTimelinePlan(days, { includeArrival: false, includeDeparture: false });

  assert.equal(plan.length, 2);
  assert.equal(plan[0].transferTag, "@transfer");
  assert.equal(plan[1].transferTag, "");
});

test("adds arrival/departure boundary rows by default, respecting per-trip opt-out", () => {
  const result = parseHotelItinerary(`
Day 1	Osaka	Arrival and free evening
2	Kyoto	Shinkansen Osaka-Kyoto
3	Flight back
`, { startDate: "2026-08-12" });

  const plan = buildHotelTimelinePlan(result.days);
  assert.equal(plan.length, 4); // arrival, hotel1, hotel2(shifted), departure
  assert.equal(plan[0].isBoundary, true);
  assert.equal(plan[0].kind, "arrival");
  assert.equal(plan[0].rowIndex, 0);
  assert.equal(plan[0].tag, "@ArrivalInJapan");
  assert.equal(plan[1].hotelRowIndex, 1);
  assert.equal(plan[2].hotelRowIndex, 3); // hotel1's own transfer-after takes rows 1-2, so hotel2 lands on row 3
  const last = plan[plan.length - 1];
  assert.equal(last.isBoundary, true);
  assert.equal(last.kind, "departure");
  assert.equal(last.tag, "@DepartureDay");

  const withoutArrival = buildHotelTimelinePlan(result.days, { includeArrival: false });
  assert.equal(withoutArrival[0].isBoundary, undefined);
  assert.equal(withoutArrival[0].hotelRowIndex, 0);
  assert.equal(withoutArrival[withoutArrival.length - 1].kind, "departure");

  const withNeither = buildHotelTimelinePlan(result.days, { includeArrival: false, includeDeparture: false });
  assert.equal(withNeither.every((item) => !item.isBoundary), true);
});
