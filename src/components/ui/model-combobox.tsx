"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type ModelOption = {
  id: string;
  name: string;
  contextLength: number | null;
  promptPerM: number | null;
  completionPerM: number | null;
};

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: ModelOption[];
  suggested?: string[];
  placeholder?: string;
  /** Texto de la opción vacía (p. ej. "Usar el del agente"); sin él no se ofrece. */
  emptyLabel?: string;
  disabled?: boolean;
};

function formatContext(n: number | null): string | null {
  if (n === null) return null;
  return n >= 1000 ? `${Math.round(n / 1000)}k ctx` : `${n} ctx`;
}

function formatPrice(m: ModelOption): string | null {
  if (m.promptPerM === null && m.completionPerM === null) return null;
  const f = (v: number | null) =>
    v === null ? "—" : v === 0 ? "0" : v < 0.01 ? "<0.01" : v.toFixed(2);
  return `$${f(m.promptPerM)} / $${f(m.completionPerM)} por 1M`;
}

/**
 * Combobox con filtro para elegir un modelo del catálogo (009, US1).
 * Siempre acepta texto libre: un ID que no esté en la lista se guarda igual.
 * Sin dependencias: input `role=combobox` + listbox propio.
 */
export function ModelCombobox({
  id,
  value,
  onChange,
  options,
  suggested = [],
  placeholder,
  emptyLabel,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Solo filtra lo que se tipea DESPUÉS de abrir: quien abre con el botón o
  // el foco quiere explorar el catálogo, no buscar el valor que ya tiene.
  const [typed, setTyped] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    const base =
      !typed || !q
        ? options
        : options.filter(
            (o) => o.id.toLowerCase().includes(q) || o.name.toLowerCase().includes(q)
          );
    const sug = base.filter((o) => suggested.includes(o.id));
    const rest = base.filter((o) => !suggested.includes(o.id));
    return { sug, rest, all: [...sug, ...rest] };
  }, [value, typed, options, suggested]);

  type Row = { kind: "empty" } | { kind: "model"; model: ModelOption };
  const rows: Row[] = useMemo(
    () => [
      ...(emptyLabel ? [{ kind: "empty" } as Row] : []),
      ...filtered.all.map((model) => ({ kind: "model", model }) as Row),
    ],
    [emptyLabel, filtered.all]
  );

  useEffect(() => {
    setActive(0);
  }, [value, open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function pick(row: Row) {
    onChange(row.kind === "empty" ? "" : row.model.id);
    setTyped(false);
    setOpen(false);
  }

  function openToBrowse() {
    setTyped(false);
    setOpen(true);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) openToBrowse();
      else setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && rows[active]) {
        e.preventDefault();
        pick(rows[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const hasCatalog = options.length > 0;

  function renderModel(m: ModelOption, index: number) {
    const ctx = formatContext(m.contextLength);
    const price = formatPrice(m);
    return (
      <li
        key={m.id}
        id={`${listboxId}-${index}`}
        role="option"
        aria-selected={m.id === value}
        className={cn(
          "cursor-pointer px-3 py-1.5 text-sm",
          index === active && "bg-accent",
          m.id === value && "font-medium"
        )}
        onMouseEnter={() => setActive(index)}
        onMouseDown={(e) => {
          e.preventDefault();
          pick({ kind: "model", model: m });
        }}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate">{m.id}</span>
          {ctx && <span className="shrink-0 text-xs text-muted-foreground">{ctx}</span>}
        </div>
        <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{m.name}</span>
          {price && <span className="shrink-0">{price}</span>}
        </div>
      </li>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={open && rows[active] ? `${listboxId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setTyped(true);
          if (hasCatalog) setOpen(true);
        }}
        onFocus={() => hasCatalog && openToBrowse()}
        onKeyDown={onKeyDown}
        className="flex h-9 w-full rounded-md border border-input bg-transparent py-1 pl-3 pr-8 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      />
      {hasCatalog && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Abrir catálogo de modelos"
          disabled={disabled}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
          onMouseDown={(e) => {
            e.preventDefault();
            if (open) setOpen(false);
            else openToBrowse();
          }}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      )}
      {open && hasCatalog && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover py-1 shadow-md"
        >
          {rows.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              Sin coincidencias en el catálogo — se usará el texto tal cual.
            </li>
          )}
          {rows.map((row, index) => {
            if (row.kind === "empty") {
              return (
                <li
                  key="__empty"
                  id={`${listboxId}-${index}`}
                  role="option"
                  aria-selected={value === ""}
                  className={cn(
                    "cursor-pointer px-3 py-1.5 text-sm italic text-muted-foreground",
                    index === active && "bg-accent"
                  )}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(row);
                  }}
                >
                  {emptyLabel}
                </li>
              );
            }
            const isFirstSug = filtered.sug[0]?.id === row.model.id;
            const isFirstRest = filtered.rest[0]?.id === row.model.id;
            return (
              <div key={row.model.id} role="presentation">
                {isFirstSug && (
                  <li role="presentation" className="px-3 pb-0.5 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Sugeridos
                  </li>
                )}
                {isFirstRest && filtered.sug.length > 0 && (
                  <li role="presentation" className="px-3 pb-0.5 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Todos
                  </li>
                )}
                {renderModel(row.model, index)}
              </div>
            );
          })}
        </ul>
      )}
    </div>
  );
}
