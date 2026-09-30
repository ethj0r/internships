import { useEffect, useState } from "react";
import { api, type ModelChoice } from "../lib/api";
import { useResource } from "../lib/hooks";

const STORAGE_KEY = "internships.model";

function stored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * The model to generate with: the last one picked in this browser if it's still available, else the server default.
 * Options come from config/models.json; ones whose API key isn't set don't appear.
 */
export function useModelChoice(): { options: ModelChoice[]; model: string | undefined; setModel: (id: string) => void } {
  const { data } = useResource("models", api.models);
  const options = data ?? [];
  const [model, setModelState] = useState<string | undefined>(() => stored() ?? undefined);
  useEffect(() => {
    if (!options.length) return;
    if (!model || !options.some((o) => o.id === model)) setModelState(options.find((o) => o.isDefault)?.id ?? options[0]!.id);
  }, [options, model]);
  const setModel = (id: string) => {
    setModelState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Private mode: the choice lasts for this page only.
    }
  };
  return { options, model: options.some((o) => o.id === model) ? model : undefined, setModel };
}

export function ModelPicker({ choice, disabled }: { choice: ReturnType<typeof useModelChoice>; disabled?: boolean }) {
  const { options, model, setModel } = choice;
  if (options.length < 2) return null;
  const current = options.find((o) => o.id === model);
  return (
    <div className="model-picker">
      <label className="subhead" htmlFor="model-picker">
        Model
      </label>
      <select id="model-picker" className="select" value={model ?? ""} disabled={disabled} onChange={(e) => setModel(e.target.value)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label} · {o.host}
          </option>
        ))}
      </select>
      {current && <p className="caption muted">{current.note}</p>}
    </div>
  );
}
