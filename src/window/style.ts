// The Mod page's stylesheet, added while the plugin is active. Everything is scoped to [data-ocm], the page's root.
// The app's own Tailwind build only has the utilities the app itself uses, so the layout utilities the page relies on
// are defined here too; and the app sizes text fields and row controls for single short controls, so rows and
// controls here wrap and shrink instead of running past the window's edge.
export const css = `
[data-ocm] { container-type: inline-size; min-width: 0; max-width: 100%; overflow-wrap: anywhere; }

[data-ocm] .flex { display: flex; }
[data-ocm] .flex-col { flex-direction: column; }
[data-ocm] .flex:not(.flex-col) { flex-wrap: wrap; }
[data-ocm] .flex > * { min-width: 0; }
[data-ocm] .flex-1 { flex: 1 1 0%; }
[data-ocm] .items-center { align-items: center; }
[data-ocm] .items-end { align-items: flex-end; }
[data-ocm] .justify-end { justify-content: flex-end; }
[data-ocm] .justify-between { justify-content: space-between; }
[data-ocm] .gap-1 { gap: 4px; }
[data-ocm] .gap-2 { gap: 8px; }
[data-ocm] .gap-3 { gap: 12px; }
[data-ocm] .gap-4 { gap: 16px; }
[data-ocm] .gap-6 { gap: 24px; }
[data-ocm] .grid { display: grid; }
[data-ocm] .grid-cols-1,
[data-ocm] .md\\:grid-cols-2,
[data-ocm] .md\\:grid-cols-3 { grid-template-columns: minmax(0, 1fr); }
@container (min-width: 620px) {
  [data-ocm] .md\\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  [data-ocm] .md\\:grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
[data-ocm] .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-ocm] .whitespace-pre-wrap { white-space: pre-wrap; }
[data-ocm] .overflow-y-auto { overflow-y: auto; }
[data-ocm] .max-h-72 { max-height: 18rem; }
[data-ocm] .min-w-48 { min-width: min(12rem, 100%); }
[data-ocm] .max-w-\\[60ch\\] { max-width: 60ch; }
[data-ocm] .cursor-pointer { cursor: pointer; }
[data-ocm] .rounded-md { border-radius: 6px; }
[data-ocm] .border { border-width: 1px; border-style: solid; }
[data-ocm] .border-b { border-bottom-width: 1px; border-bottom-style: solid; }
[data-ocm] .border-v2-border-border-base { border-color: var(--v2-border-border-base); }
[data-ocm] .border-v2-border-border-weak { border-color: var(--v2-border-border-weak, var(--v2-border-border-base)); }
[data-ocm] .p-4 { padding: 16px; }
[data-ocm] .px-3 { padding-inline: 12px; }
[data-ocm] .px-4 { padding-inline: 16px; }
[data-ocm] .py-1 { padding-block: 4px; }
[data-ocm] .pb-2 { padding-bottom: 8px; }
[data-ocm] .pb-3 { padding-bottom: 12px; }

/* Navigation: labelled groups of pills, like the app's segmented controls. */
[data-ocm] .ocm-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
  padding-bottom: 12px;
  border-bottom: 0.5px solid var(--v2-border-border-base);
}
[data-ocm] .ocm-nav-group { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
[data-ocm] .ocm-nav-label {
  font-size: 11px;
  font-weight: 530;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--v2-text-text-muted);
}
[data-ocm] .ocm-nav-items {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--v2-alpha-light-2, rgba(127, 127, 127, 0.08));
}
[data-ocm] .ocm-nav-item {
  appearance: none;
  border: 0;
  border-radius: 6px;
  padding: 4px 10px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 480;
  line-height: 20px;
  white-space: nowrap;
  color: var(--v2-text-text-muted);
  background: transparent;
  cursor: pointer;
  transition: background 120ms ease-out, color 120ms ease-out, box-shadow 120ms ease-out;
}
[data-ocm] .ocm-nav-item:hover { color: var(--v2-text-text-base); background: var(--v2-overlay-simple-overlay-hover, rgba(127, 127, 127, 0.12)); }
[data-ocm] .ocm-nav-item:focus-visible { outline: 1px solid var(--v2-border-border-focus); outline-offset: 1px; }
[data-ocm] .ocm-nav-item[aria-selected="true"] {
  color: var(--v2-text-text-base);
  background: var(--v2-background-bg-base);
  box-shadow: var(--v2-elevation-button-neutral, 0 1px 2px rgba(0, 0, 0, 0.25));
}

/* The open tab shows at once: a fade from transparent painted the dark background for a frame on the heavier tabs. */
[data-ocm] .ocm-panel { display: flex; flex-direction: column; gap: 12px; }
[data-ocm] .ocm-panel-title { font-size: 15px; font-weight: 560; color: var(--v2-text-text-base); margin: 0; }
@media (prefers-reduced-motion: reduce) { [data-ocm] .ocm-nav-item { transition: none; } }

/* An entry's editor, opened in place below its row. */
[data-ocm] .ocm-inline-editor { padding: 4px 0 12px; }

/* Settings rows: the copy and the control share the line while they fit, then the control moves below. */
[data-ocm] [data-component="settings-row"] { flex-wrap: wrap; row-gap: 10px; }
[data-ocm] [data-slot="settings-row-copy"] { flex: 1 1 240px; }
[data-ocm] [data-slot="settings-row-control"] { flex: 0 1 auto; width: auto; min-width: 0; max-width: 100%; }
[data-ocm] [data-slot="settings-row-control"] > .flex { justify-content: flex-end; }

/* Fields fill the space they get and never push past it. */
[data-ocm] [data-component="text-input-v2"] { width: 100%; max-width: 100%; min-width: 0; flex: none; }
/* Beside buttons in a row, a field takes the room left; a size in a column would become its height instead. */
[data-ocm] .flex:not(.flex-col) > [data-component="text-input-v2"]:not(.ocm-select) { width: auto; flex: 1 1 160px; }
[data-ocm] [data-slot="settings-row-control"] .flex:not(.flex-col) > [data-component="text-input-v2"]:not(.ocm-select) { width: 200px; flex: 1 1 140px; }
[data-ocm] [data-slot="settings-row-control"] > [data-component="text-input-v2"]:not(.ocm-select) { width: 200px; }
[data-ocm] [data-component="textarea-v2"] { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }
[data-ocm] [data-component="button-v2"] { flex: none; max-width: 100%; }

/* Dropdowns: a native select drawn like the app's fields. */
[data-ocm] .ocm-select { position: relative; width: auto; min-width: min(160px, 100%); flex: 0 1 auto; padding-inline: 0; }
[data-ocm] .ocm-select select {
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  height: 100%;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--v2-text-text-base);
  font: inherit;
  font-size: 13px;
  padding-inline: 10px 28px;
  cursor: pointer;
  text-overflow: ellipsis;
}
[data-ocm] .ocm-select select:disabled { cursor: not-allowed; }
[data-ocm] .ocm-select select option { background: var(--v2-background-bg-base, #1b1b1b); color: var(--v2-text-text-base); }
[data-ocm] .ocm-select::after {
  content: "";
  position: absolute;
  right: 10px;
  top: 50%;
  width: 6px;
  height: 6px;
  border-right: 1.5px solid var(--v2-icon-icon-muted, currentColor);
  border-bottom: 1.5px solid var(--v2-icon-icon-muted, currentColor);
  transform: translateY(-70%) rotate(45deg);
  pointer-events: none;
}

/* The glow color: a swatch that opens the system picker, beside the hex field. */
[data-ocm] .ocm-swatch {
  width: 28px;
  height: 28px;
  flex: none;
  padding: 0;
  border: 1px solid var(--v2-border-border-base);
  border-radius: 6px;
  background: none;
  cursor: pointer;
}
[data-ocm] .ocm-swatch::-webkit-color-swatch-wrapper { padding: 2px; }
[data-ocm] .ocm-swatch::-webkit-color-swatch { border: 0; border-radius: 4px; }
[data-ocm] [data-slot="settings-row-control"] .ocm-hex { width: 110px; flex: 0 1 110px; }
[data-ocm] .ocm-gradient {
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: 6px;
  background: conic-gradient(#22d3ee, #8b5cf6, #ec4899, #f59e0b, #22d3ee);
}
`
