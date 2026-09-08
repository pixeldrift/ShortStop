import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every icon under src/components/icons/*.svg imports as a React
  // component (SVGR) rather than a URL - a plain <img src="...svg">
  // would isolate the SVG from this app's own CSS, breaking every
  // icon's `currentColor` fill/stroke (how each one picks up whatever
  // text color its caller's className sets) the moment it stopped
  // being inline markup. `removeViewBox: false` since every one of
  // these files defines only a viewBox, no width/height - SVGO's
  // default removeViewBox plugin only strips a *redundant* viewBox
  // (one that duplicates existing width/height attributes), so this
  // is just an explicit guarantee against a future SVGO default change
  // silently breaking every icon's own coordinate system.
  turbopack: {
    rules: {
      "*.svg": {
        loaders: [
          {
            loader: "@svgr/webpack",
            options: {
              svgo: true,
              svgoConfig: {
                plugins: [{ name: "preset-default", params: { overrides: { removeViewBox: false } } }],
              },
            },
          },
        ],
        as: "*.js",
      },
    },
  },
};

export default nextConfig;
