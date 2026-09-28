// To add a platform: implement SourceAdapter in ./sources, register it here,
// and add the kind to SOURCE_KINDS (shared/types.ts) and the sources.kind CHECK constraint.

import type { SourceKind } from "../../shared/types";
import { ashby } from "./sources/ashby";
import { catapa } from "./sources/catapa";
import { greenhouse } from "./sources/greenhouse";
import { himalayas } from "./sources/himalayas";
import { lever } from "./sources/lever";
import { smartrecruiters } from "./sources/smartrecruiters";
import { themuse } from "./sources/themuse";
import { workable } from "./sources/workable";
import type { SourceAdapter } from "./types";

export const ADAPTERS: Record<Exclude<SourceKind, "manual">, SourceAdapter> = {
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  workable,
  catapa,
  themuse,
  himalayas,
};

export function adapterFor(kind: SourceKind): SourceAdapter | null {
  return kind === "manual" ? null : ADAPTERS[kind];
}
