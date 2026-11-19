# Kenaz ᚲ

**A torch held to the past.** Kenaz is the old Norse rune for "torch." A satellite globe overlaid with old maps, photographs, drawings, newspaper clippings, historic events and strange accounts pulled live from free public archives. Zoom into any town and it becomes a museum you can walk through in time.

## What's on the map
- **Old maps**: georeferenced maps from David Rumsey, NYPL, Library of Congress, Harvard, Yale and others (via [Allmaps](https://allmaps.org)), draped over the satellite with a see-through slider.
- **Photos & drawings**: Wikimedia Commons files near the map center; Europeana across Europe.
- **Newspapers**: Library of Congress *Chronicling America* (1770–1963), searched by topic in period wording and pinned on the town that printed each page. "Trace reprints" finds every paper that ran the same story.
- **Strange**: 85 hand-picked case files plus ~4,000 hoaxes, sightings, ghost towns, meteorite falls and lost places from Wikidata.
- **Events** and **Ancient sites**: ~10,000 dated battles, disasters and fairs; ~17,000 megaliths, mounds, petroglyphs, hillforts and ancient cities.
- **Historic places**: Wikipedia articles about old buildings and sites near the center.

## The museum
Tap the columns icon anywhere to open the museum of that place: Gallery, Map room, Library, Newspapers, and Oddities & events, each arranged room by room, decade by decade, following the time dial.

## Notes
- No build step, no keys, no backend. Static files served by GitHub Pages.
- `data/strange.json`, `data/events.json` and `data/ancient.json` are snapshots of Wikidata (CC0) taken November 2026. `data/cases.json` is hand-written.
- Saved items ("case file") stay in the browser's local storage on each device.
- Satellite imagery © Esri, Maxar, Earthstar Geographics. Map library: MapLibre GL JS (BSD-3).
