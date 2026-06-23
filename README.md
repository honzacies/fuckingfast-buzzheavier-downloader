# fuckingfast-extractor

A tiny CLI that batch-downloads files from **fuckingfast.co** (and **buzzheavier.com**) links — built mainly for grabbing multi-part [FitGirl repacks](https://fitgirl-repacks.site/) without having to open every link and click through manually.

You paste a list of links into `list.txt`, run one command, and it scrapes the real download URL behind each page and pulls the files into a `downloads/` folder with a live progress bar.

> **Disclaimer:** This is a personal automation tool provided for educational purposes. Only download content you have the legal right to access. You are responsible for how you use it.

## Features

- **Batch downloads** — one URL per line in `list.txt`, processed top to bottom.
- **Link scraping** — extracts the actual file URL from the `fuckingfast.co` page (`window.open(...)`) automatically.
- **buzzheavier.com support** — handles its HTMX `hx-redirect` flow to reach the final download link.
- **Live progress bar** — shows percentage, downloaded / total size (auto-formatted as KB/MB/GB), speed, and estimated time remaining.
- **Resume-friendly history** — finished downloads are recorded in `downloads/history.json` and skipped on the next run.
- **Zero dependencies** — uses only the Node.js standard library (`http`, `https`, `http2`, `zlib`, `fs`, …).

## Requirements

You only need **one** of the following:

- [**Bun**](https://bun.sh/) — easiest, runs TypeScript directly.
- [**Node.js**](https://nodejs.org/) **v23.6+** — runs `.ts` files natively. (On v22.x use the `--experimental-strip-types` flag, shown below.)

No build step and no `npm install` required — there are no third-party dependencies.

## Installation

```bash
git clone https://github.com/honzacies/fuckingfast-extractor.git
cd fuckingfast-extractor
```

That's it.

## Usage

1. **Create a `list.txt`** in the project root and add one link per line. The part after `#` is just the filename hint and is ignored by the host:

   ```text
   https://fuckingfast.co/tu498dk1d7ab#Forza_Horizon_6_--_fitgirl-repacks.site_--_.part01.rar
   https://fuckingfast.co/o4hij09fmd3g#Forza_Horizon_6_--_fitgirl-repacks.site_--_.part02.rar
   https://buzzheavier.com/abc123xyz
   ```

2. **Run it:**

   **With Bun:**
   ```bash
   bun index.ts
   ```

   **With Node.js (v23.6+):**
   ```bash
   node index.ts
   ```

   **With Node.js v22.x:**
   ```bash
   node --experimental-strip-types index.ts
   ```

3. Files land in the **`downloads/`** folder (created automatically). Already-completed links are skipped on subsequent runs.

## How it works

For each link in `list.txt`:

- **`fuckingfast.co`** — fetches the page over HTTP/2 (with browser-like headers), finds the `window.open("...")` call in the HTML, and downloads the file it points to.
- **`buzzheavier.com`** — sends an HTMX-style request to the `/download` endpoint, reads the `hx-redirect` header, and follows it to the final file.

Progress is rendered in place in the terminal, and on completion the link → filename mapping is written to `downloads/history.json` so it won't be re-downloaded next time.

## Configuration

A few constants at the top of [`index.ts`](index.ts) can be tweaked:

| Constant        | Default        | Description                                                        |
| --------------- | -------------- | ------------------------------------------------------------------ |
| `DOWNLOAD_DIR`  | `./downloads`  | Where files are saved.                                             |
| `HISTORY_FILE`  | `./downloads/history.json` | Tracks completed downloads for skip-on-rerun.          |
| `REQUIRED_SIZE` | `500 MB`       | Fallback total size used when a server doesn't send `content-length`. |
| `USER_AGENT`    | Chrome UA      | User-Agent string sent with requests.                              |

## License

[MIT](LICENSE) © honzacies
