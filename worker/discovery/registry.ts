// To add a platform: implement SourceAdapter in ./sources, register it here,
// and add the kind to SOURCE_KINDS (shared/types.ts) and the sources.kind CHECK constraint.

import type { SourceKind } from "../../shared/types";
import { ashby } from "./sources/ashby";
import { greenhouse } from "./sources/greenhouse";
import { lever } from "./sources/lever";
import { themuse } from "./sources/themuse";
import type { SourceAdapter } from "./types";

export const ADAPTERS: Record<Exclude<SourceKind, "manual">, SourceAdapter> = {
  greenhouse,
  lever,
  ashby,
  themuse,
};

export function adapterFor(kind: SourceKind): SourceAdapter | null {
  return kind === "manual" ? null : ADAPTERS[kind];
}
