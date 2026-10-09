import { definePlugin } from "nitro";
import { getStation } from "./station.server";

/** Boot the station with the server: socket handlers, crew wiring and startup reconcile. */
export default definePlugin(() => {
  getStation();
});
