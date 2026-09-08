// Every icon under src/components/icons/*.svg imports as a React
// component via SVGR (see next.config.ts's own turbopack.rules) - this
// is what tells TypeScript what that import actually returns, since a
// plain .svg file has no type information of its own.
declare module "*.svg" {
  import type { FC, SVGProps } from "react";
  const Icon: FC<SVGProps<SVGSVGElement>>;
  export default Icon;
}
