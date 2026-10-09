/** One Engineer per mission (M1), so a crew id is derived from its mission id. */
export const crewIdFor = (missionId: string) => `crew-${missionId}`;
export const missionIdForCrew = (crewId: string) => crewId.replace(/^crew-/, "");
