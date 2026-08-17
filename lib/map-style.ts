import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";

export const DOMAIN_FILL: ExpressionSpecification = [
  "match",
  ["get", "domainId"],
  "domain:3",
  "#2f92b5",
  "domain:1",
  "#2f9a5f",
  "domain:4",
  "#c45a6a",
  "domain:2",
  "#d0943a",
  "#3d7d90",
];

export const DOMAIN_COAST: ExpressionSpecification = [
  "match",
  ["get", "domainId"],
  "domain:3",
  "#b7eefc",
  "domain:1",
  "#b6f3d0",
  "domain:4",
  "#ffd0d7",
  "domain:2",
  "#ffe3a8",
  "#e8f4f8",
];

export const MAP_STYLE: StyleSpecification = {
  version: 8,
  name: "puzzle",
  glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#08202c" },
    },
  ],
  light: {
    anchor: "viewport",
    color: "#ffffff",
    intensity: 0.45,
    position: [1.15, 210, 30],
  },
  sky: {
    "sky-color": "#0a2433",
    "horizon-color": "#2a5a72",
    "fog-color": "#071820",
    "sky-horizon-blend": 0.35,
    "horizon-fog-blend": 0.25,
    "fog-ground-blend": 0.15,
    "atmosphere-blend": [
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      0.45,
      3,
      0.15,
      6,
      0,
    ],
  },
};

export const INITIAL_VIEW = {
  center: [-20, 14] as [number, number],
  zoom: 1.55,
  pitch: 8,
  bearing: 8,
};
