> **This is a fork of work by [kind2908](https://github.com/kind2908). I take no ownership of it.**
> All credit for the original app, its data and its design belongs to the original author.
>
> **Why this fork exists:** it is a personal copy for my own use, so I still have the app if the original is ever deleted, and so I can add my own custom changes. Full props go to the creator.

# Morska Ribalka (Sea Fishing, Adriatic)

A static web app (PWA) that estimates the best time to go sea fishing from weather, sea state, season, time of day and moon phase. It also has a catch diary, a fish library and a map.

There is no backend and no build step: serve the files in this folder with any static web server.

## Data sources

- Weather, waves, water temperature and currents: [Open-Meteo](https://open-meteo.com/)
- Weather stations (METAR): [MET Norway](https://api.met.no/)
- Sea depth: [EMODnet Bathymetry](https://emodnet.ec.europa.eu/en/bathymetry)
- Map tiles: Esri World Imagery, Leaflet from cdnjs
- Fish pictures: Wikipedia and Wikimedia Commons

## Notes

- The fishing score is a hand-tuned heuristic, not a fitted or validated model. Treat it as a rough guide.
- Fishing rules in the app were collected by the original author from public sources and may be out of date. Check them with the local authority before fishing.
