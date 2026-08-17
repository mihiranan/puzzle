# Puzzle

A map of human knowledge.

Puzzle turns academic research into a place you can travel through. Continents are the four OpenAlex domains — Physical Sciences, Life Sciences, Health Sciences, Social Sciences. Countries are fields. Provinces are subfields. Cities are topics. Papers, researchers, universities, and journals live in the neighborhoods they actually built.

## What you can do

- Spin a globe of research and zoom from **Computer Science** into **Artificial Intelligence** into a single topic
- Search a professor, university, paper, or field and fly there
- Open anything to see its intellectual neighborhood: collaborators, adjacent fields, influential work
- Drag the year and watch what the landscape looked like in 1986, 2012, or last year

## Run it

```bash
npm install
npm run atlas    # builds the world from OpenAlex (once)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The atlas is a generated geography: OpenAlex’s taxonomy (4 domains → 26 fields → 252 subfields → ~4,500 topics) laid out as land. Live search, papers, people, and institutions come from the [OpenAlex](https://openalex.org) API.

Optional environment variables live in `.env.example`. An API key is not required.

## How the map is made

`scripts/build-atlas.mjs` fetches the OpenAlex topic tree and projects it onto a globe:

1. Each domain becomes a continent
2. Fields are Voronoi countries packed inside that continent
3. Subfields are provinces inside each country
4. Topics become cities
5. Works, authors, and institutions are geocoded to their primary topic, with a stable jitter so the same paper always lives on the same hill

The time slider asks OpenAlex for the most-cited work of that year in whatever region you are looking at, then drops those papers onto the land.

## Stack

Next.js, MapLibre, OpenAlex.
