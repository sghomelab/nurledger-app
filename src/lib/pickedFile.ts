/**
 * FR-314 (M6) — in-memory handoff for the picked CSV file.
 *
 * Why not pass the URI through the router query string: SAF content URIs
 * contain percent-encoded document ids (e.g. `document%3A123` on Android).
 * `takePersistableUriPermission` registers the grant under that EXACT
 * (encoded) string, and Android's AMS grant lookup is an exact Uri match —
 * but expo-router decodes query params on the receiving screen, turning
 * `document%3A123` into `document:123`. The read then fails with
 * SecurityException because the grant key no longer matches.
 *
 * Keeping the raw URI in module state preserves the exact string the
 * picker (and the grant) used. A process restart clears both this and the
 * transient grants, so losing the handoff is always consistent.
 */
export interface PickedFile {
  uri: string;
  name: string | null;
}

let current: PickedFile | null = null;

export function setPickedFile(file: PickedFile): void {
  current = file;
}

export function getPickedFile(): PickedFile | null {
  return current;
}

export function clearPickedFile(): void {
  current = null;
}
