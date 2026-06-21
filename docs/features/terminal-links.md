# Clickable terminal links + image preview

Ctrl/Cmd+click in any terminal (cmd, PowerShell, tmux, ssh, …) to:

- **Open a URL** — http(s) URLs open in the default browser (`shell:openExternal`, http(s) only).
- **Preview an image** — a referenced image opens in a lightbox overlay:
  - local file paths (resolved against the pane's tracked cwd; `~` against home), and
  - http(s) image URLs.

Detection runs on the rendered xterm buffer, so it is shell- and tmux-agnostic. Hovering a
link underlines it; only Ctrl/Cmd+click activates (plain click stays free for cursor positioning).

## How it works

- **URLs:** `@xterm/addon-web-links` finds http(s) URLs (handles wrapped lines). A custom handler
  routes image URLs to the lightbox and everything else to `shell:openExternal`.
- **Local image paths:** a custom xterm link provider over `findImagePaths` (`src/shared/terminal-links.ts`).
  Disabled in SSH panes — a local-looking path there lives on the remote and can't be read locally;
  image URLs still work.
- **Loading:** the renderer CSP is `img-src 'self' data:`, so main loads the bytes (file read or
  fetch) and returns a base64 data URL (`preview:loadImage`); the renderer never loads remote
  images directly (no CORS, no CSP loosening). 25 MiB cap.
- **Lightbox:** `ImageLightbox` portals to `<body>`; backdrop/Esc close (Esc is captured so the
  focused xterm doesn't eat it first); click the image to toggle fit↔100%.

## Where things live

| Piece | Path |
|---|---|
| Detection/classification (pure) | `src/shared/terminal-links.ts` |
| xterm wiring | `src/renderer/terminal/links.ts` |
| Open URL (main) | `src/main/ipc/register-shell.ts` |
| Load image (main) | `src/main/ipc/register-preview.ts` |
| Lightbox state | `src/renderer/store/preview-slice.ts` |
| Lightbox UI | `src/renderer/components/ImageLightbox.tsx` |

## Non-goals (v1)

SCP-from-remote previews, auto-follow/auto-show, inline terminal thumbnails, zoom/pan beyond
fit↔100%, linkifying non-image local files, and paths containing spaces (unless quoted).
