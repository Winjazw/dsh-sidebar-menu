/**
 * Host half of `@local/sidebar-menu`.
 *
 * The whole feature lives in the Client half (`client.js`): it registers a
 * sidebar footer button plus one `shell.overlay` panel, and it keeps the
 * hidden-panel list in the browser's localStorage. Nothing has to run in the
 * Host process, so this apply stays intentionally empty — it only gives the
 * bundle patch a resolvable plugin row.
 */
export function apply() {}
