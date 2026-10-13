/** Mints the id of a new role / station / shift template, in one shape (`<prefix><time><random>`). */
export function randomId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
}
