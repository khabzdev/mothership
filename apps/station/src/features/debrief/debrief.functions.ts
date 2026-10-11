import { createServerFn } from "@tanstack/react-start";
import { getStation } from "../../app/station.server";
import type { Lesson, LessonResult } from "./debrief.server";
import { parseDeckInput, parseLessonInput } from "./model";

/** The deck's lessons waiting for review and the ones it keeps. */
export const getLessons = createServerFn()
  .validator(parseDeckInput)
  .handler(({ data }): { pending: Lesson[]; kept: Lesson[] } =>
    getStation().debrief.list(data.deckId),
  );

/** Y: keep a pending lesson; new crew are told it from then on. */
export const keepLesson = createServerFn({ method: "POST" })
  .validator(parseLessonInput)
  .handler(({ data }): LessonResult => getStation().debrief.keep(data.lessonId));

/** N: drop a pending lesson. */
export const dropLesson = createServerFn({ method: "POST" })
  .validator(parseLessonInput)
  .handler(({ data }): LessonResult => getStation().debrief.drop(data.lessonId));

/** R: retire a kept lesson. */
export const retireLesson = createServerFn({ method: "POST" })
  .validator(parseLessonInput)
  .handler(({ data }): LessonResult => getStation().debrief.retire(data.lessonId));
