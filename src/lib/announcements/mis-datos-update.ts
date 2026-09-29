/** Versión del aviso: subir al publicar un mensaje nuevo. */
export const MIS_DATOS_UPDATE_ANNOUNCEMENT_VERSION = "v2";

const STORAGE_KEY = `lia_mis_datos_update_ann_${MIS_DATOS_UPDATE_ANNOUNCEMENT_VERSION}`;

export function hasSeenMisDatosUpdateAnnouncement(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

export function markMisDatosUpdateAnnouncementSeen(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* quota / private mode */
  }
}
