# Puzzle

A map of human knowledge.

Domains are continents, fields are countries, subfields are provinces, topics are cities. Papers, people, and universities sit in the neighborhoods they actually built. Search flies you there. The year slider shows the world as of that date.

## Run

```bash
npm install
npm run atlas   # once, or whenever you want a fresh world
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Optional environment variables are in `.env.example`. A key is not required.

## Layout

| Path | Role |
| --- | --- |
| `scripts/build-atlas.mjs` | Builds `public/data/atlas.json` from the research catalog |
| `components/` | Map, search, inspector, era slider |
| `app/api/` | Search, entity files, papers, eras, atlas refresh |
| `lib/` | Geography, camera, catalog client, era math |

## License

MIT
