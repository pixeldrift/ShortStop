// leaflet-rotate ships no types of its own - a side-effect import (see
// RouteMap.tsx) that patches L.Map at runtime to add map rotation, so
// TypeScript otherwise has no declaration file to find for it at all.
//
// This has to stay a global script file (no top-level import/export of
// its own) rather than living next to leaflet.d.ts's module
// augmentation - a shorthand `declare module "x";` only works as a
// fresh ambient module declaration at global scope; inside a file
// that's itself a module, it's instead treated as an (empty) attempt to
// augment "leaflet-rotate", which doesn't exist to augment, and the
// "could not find a declaration file" error stays.
declare module "leaflet-rotate";
