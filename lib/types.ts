import type { FeatureCollection, Polygon } from "geojson";

export type PlaceKind = "domain" | "field" | "subfield" | "topic";

export type EntityKind =
  | PlaceKind
  | "work"
  | "author"
  | "institution"
  | "source"
  | "keyword";

export type Place = {
  id: string;
  sourceId: string;
  name: string;
  kind: PlaceKind;
  description?: string;
  parentId: string | null;
  domainId: string;
  fieldId?: string;
  subfieldId?: string;
  worksCount: number;
  citedByCount: number;
  lon: number;
  lat: number;
  radius: number;
  fill: string;
  coast: string;
  label: string;
  zoom: number;
  labelMinZoom: number;
};

export type AtlasFeatureProperties = {
  id: string;
  name: string;
  kind: PlaceKind;
  parentId: string | null;
  domainId: string;
  fieldId: string | null;
  subfieldId: string | null;
  worksCount: number;
  citedByCount: number;
  fill: string;
  coast?: string;
  label?: string;
};

export type Atlas = {
  generatedAt: string;
  source: string;
  stats: {
    domains: number;
    fields: number;
    subfields: number;
    topics: number;
  };
  places: Place[];
  geojson: {
    domains: FeatureCollection<Polygon, AtlasFeatureProperties>;
    fields: FeatureCollection<Polygon, AtlasFeatureProperties>;
    subfields: FeatureCollection<Polygon, AtlasFeatureProperties>;
    topics: FeatureCollection<Polygon, AtlasFeatureProperties>;
  };
};

export type SearchHit = {
  id: string;
  sourceId: string;
  kind: EntityKind;
  name: string;
  hint?: string | null;
  citedByCount?: number;
  worksCount?: number;
  year?: number | null;
  placeId?: string | null;
};

export type Pin = {
  id: string;
  kind: EntityKind;
  name: string;
  lon: number;
  lat: number;
  hint?: string | null;
  citedByCount?: number;
  year?: number | null;
  emphasis?: boolean;
  era?: boolean;
  placeId?: string | null;
};

export type EraLandscape = {
  year: number;
  pins: Pin[];
  fieldActivity: Record<string, number>;
  domainActivity: Record<string, number>;
  fieldGrowth: Record<string, number>;
  domainGrowth: Record<string, number>;
  headline: string | null;
  hottestField: string | null;
};

export type FlyTo = {
  lon: number;
  lat: number;
  zoom: number;
  id: string;
};

export type NeighborhoodLink = {
  id: string;
  kind: EntityKind;
  name: string;
  hint?: string | null;
  citedByCount?: number;
  worksCount?: number;
  year?: number | null;
};

export type InspectedEntity = {
  id: string;
  sourceId: string;
  kind: EntityKind;
  name: string;
  hint?: string | null;
  description?: string | null;
  year?: number | null;
  citedByCount?: number;
  worksCount?: number;
  doi?: string | null;
  url?: string | null;
  image?: string | null;
  path: Place[];
  place: Place | null;
  lon: number;
  lat: number;
  topics: NeighborhoodLink[];
  people: NeighborhoodLink[];
  institutions: NeighborhoodLink[];
  works: NeighborhoodLink[];
  sources: NeighborhoodLink[];
  alsoIn: NeighborhoodLink[];
  whyHere?: string | null;
};
