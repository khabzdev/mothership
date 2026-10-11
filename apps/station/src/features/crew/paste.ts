/** Delay between pasting a prompt and pressing Enter (as agent-office does). */
export const SUBMIT_DELAY_MS = 120;

/** Text as one bracketed paste: the agent's input box takes it whole, line breaks included. */
export const bracketedPaste = (text: string) => `\x1b[200~${text}\x1b[201~`;
