/** Back-compat shim. The implementation now lives in `keybindings.ts`; this keeps existing
 *  `@shared/keymap` import sites (and `tests/keymap.test.ts`) working. */
export * from './keybindings'
