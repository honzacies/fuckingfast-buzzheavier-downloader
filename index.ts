import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import * as readline from 'readline';
import http2 from "node:http2";
import zlib from "node:zlib";

const DOWNLOAD_DIR = './downloads';
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36";
const REQUIRED_SIZE = 500 * 1024 * 1024;
const HISTORY_FILE = './downloads/history.json';

const STYLES = {
    reset: "\x1b[0m",
    blue: "\x1b[38;5;153m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    gray: "\x1b[90m"
};

let downloadHistory: Record<string, string> = {};
if (fs.existsSync(HISTORY_FILE)) {
    downloadHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
}

function saveHistory(url: string, fileName: string) {
    downloadHistory[url] = fileName;
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(downloadHistory, null, 2));
}

function formatBytes(bytes: number, decimals = 1): string {
    if (!bytes || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(decimals)} ${units[i]}`;
}

function formatTime(seconds: number): string {
    if (seconds <= 0) return "calculating...";
    const secs = Math.floor(seconds);
    if (secs < 60) return `${secs} seconds remaining`;
    const mins = Math.floor(secs / 60);
    return `${mins} minutes remaining`;
}

function parseFileName(disposition: string | undefined, fallbackUrl: string): string {
    let fileName = "";
    if (disposition) {
        const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
        if (utf8Match) fileName = decodeURIComponent(utf8Match[1]);
        if (!fileName) {
            const classicMatch = disposition.match(/filename=["']?([^"';]+)["']?/i);
            if (classicMatch) fileName = classicMatch[1];
        }
    }
    return fileName.trim() || path.basename(new URL(fallbackUrl).pathname) || 'file.part';
}



async function fetchText(url: string): Promise<string> {
    return url.includes("fuckingfast.co") ? fetchTextH2(url) : fetchTextH1(url);
}

function fetchTextH2(url: string, authority?: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const client = http2.connect(u.origin);   // reálně se připojí na host z URL
        client.on("error", reject);

        const req = client.request({
            ":method": "GET",
            ":path": `/${url.replace("https://", "").replace("http://", "").split("/")[1].split("#")[0]}`,          // celá cesta + query, ne jen 1. segment
            ":authority": "fuckingfast.co",       // override sem, když chceš jiný než reálný host
            ":scheme": "https",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            "Dnt": 1,
            "Pragma": "no-cache",
            "Priority": "u=0, i",
            "Sec-Ch-Ua": `"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"`,
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": "Windows",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": 1,
            "User-Agent": USER_AGENT
        })
        let status = 0;
        let location: string | undefined;
        let encoding: any;
        req.on("response", (h) => {
            status = Number(h[":status"]);
            encoding = (h["content-encoding"] as string) ?? "";
        });

        // místo req.setEncoding("utf8") + skládání stringu:
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
            client.close();
            let buf = Buffer.concat(chunks);
            if (encoding === "gzip") buf = zlib.gunzipSync(buf);
            else if (encoding === "br") buf = zlib.brotliDecompressSync(buf);
            else if (encoding === "deflate") buf = zlib.inflateSync(buf);
            resolve(buf.toString("utf8"));
        });
        req.on("error", (err) => {
            client.close();
            reject(err);
        });
        req.end();
    });
}

function fetchTextH1(url: string): Promise<string> {
    const protocol = url.startsWith("https") ? https : http;
    return new Promise((resolve, reject) => {
        protocol
            .get(url, { headers: { "User-Agent": USER_AGENT } }, (res) => {
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume(); // odpojit tělo přesměrování
                    return resolve(fetchText(new URL(res.headers.location, url).href));
                }
                let data = "";
                res.setEncoding("utf8");
                res.on("data", (c) => (data += c));
                res.on("end", () => resolve(data));
            })
            .on("error", reject);
    });
}

async function downloadFile(url: string, originalPageUrl: string): Promise<void> {
    const protocol = url.startsWith('https') ? https : http;

    return new Promise<void>((resolve, reject) => {
        const request = protocol.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                request.destroy();
                return resolve(downloadFile(new URL(res.headers.location, url).href, originalPageUrl));
            }

            const totalSize = parseInt(res.headers['content-length'] || REQUIRED_SIZE.toString(), 10);
            const fileName = parseFileName(res.headers['content-disposition'], url);
            const filePath = path.join(DOWNLOAD_DIR, fileName);
            const displayTitle = fileName.length > 60 ? fileName.substring(0, 57) + "..." : fileName;
            const fileStream = fs.createWriteStream(filePath);

            let downloadedSize = 0;
            const startTime = Date.now();
            process.stdout.write("\n\n\n");

            res.on('data', (chunk) => {
                downloadedSize += chunk.length;
                fileStream.write(chunk);

                const elapsed = (Date.now() - startTime) / 1000;
                const speed = downloadedSize / (elapsed || 0.1);
                const percent = Math.floor((downloadedSize / totalSize) * 100);
                const remainingTime = speed > 0 ? (totalSize - downloadedSize) / speed : 0;

                const barWidth = 30;
                const filledWidth = Math.min(barWidth, Math.floor((percent / 100) * barWidth));
                const bar = "█".repeat(filledWidth) + "░".repeat(Math.max(0, barWidth - filledWidth));

                readline.moveCursor(process.stdout, 0, -3);
                readline.clearLine(process.stdout, 0);
                process.stdout.write(`${STYLES.bold}${STYLES.blue}${displayTitle}${STYLES.reset}\n`);

                readline.clearLine(process.stdout, 0);
                process.stdout.write(`${STYLES.blue}${percent}% ${STYLES.dim}${bar} ${STYLES.blue}100%${STYLES.reset}\n`);

                readline.clearLine(process.stdout, 0);
                process.stdout.write(
                    `${STYLES.blue}${formatBytes(downloadedSize)} / ${formatBytes(totalSize)} ${STYLES.dim}│${STYLES.reset} ` +
                    `${STYLES.blue}${(speed / (1024 * 1024)).toFixed(2)} MB/s ${STYLES.dim}│${STYLES.reset} ` +
                    `${STYLES.blue}${formatTime(remainingTime)}${STYLES.reset}\n`
                );
            });

            res.on('end', () => {
                fileStream.end();
                saveHistory(originalPageUrl, fileName);
                process.stdout.write(`\n${STYLES.blue}Finished downloading ${STYLES.bold}${displayTitle}${STYLES.reset}\n\n`);
                resolve();
            });
        });
    });
}

async function downloadBuzzheavier(url: string, originalPageUrl: string): Promise<void> {
    // Odstraníme případné /download na konci pro čistou referer URL
    const baseUrl = url.replace(/\/download$/, "");
    const downloadUrl = `${baseUrl}/download`;
    const protocol = url.startsWith('https') ? https : http;

    return new Promise<void>((resolve, reject) => {
        process.stdout.write(`${STYLES.blue}${STYLES.dim}Requesting Buzzheavier with HTMX spoofing...${STYLES.reset}\n`);

        const requestOptions = {
            headers: {
                'User-Agent': USER_AGENT,
                'referer': baseUrl,
                'hx-current-url': baseUrl,
                'hx-request': 'true'
            }
        };

        protocol.get(downloadUrl, requestOptions, (res) => {
            // Teď už by hx-redirect měl být přítomen
            const redirectUrl = res.headers["hx-redirect"] as string;

            if (redirectUrl) {
                const finalUrl = new URL(redirectUrl, url).href;
                const finalProtocol = finalUrl.startsWith('https') ? https : http;

                finalProtocol.get(finalUrl, { headers: { 'User-Agent': USER_AGENT } }, (finalRes) => {
                    // --- Tvůj logging progress blok ---
                    const totalSize = parseInt(finalRes.headers['content-length'] || REQUIRED_SIZE.toString(), 10);
                    const totalSizeMb = (totalSize / (1024 * 1024)).toFixed(0);
                    const fileName = parseFileName(finalRes.headers['content-disposition'], finalUrl);
                    const filePath = path.join(DOWNLOAD_DIR, fileName);
                    const displayTitle = fileName.length > 60 ? fileName.substring(0, 57) + "..." : fileName;
                    const fileStream = fs.createWriteStream(filePath);

                    let downloadedSize = 0;
                    const startTime = Date.now();
                    process.stdout.write("\n\n\n");

                    finalRes.on('data', (chunk) => {
                        downloadedSize += chunk.length;
                        fileStream.write(chunk);

                        const elapsed = (Date.now() - startTime) / 1000;
                        const speed = downloadedSize / (elapsed || 0.1);
                        const percent = Math.floor((downloadedSize / totalSize) * 100);
                        const remainingTime = speed > 0 ? (totalSize - downloadedSize) / speed : 0;

                        const barWidth = 30;
                        const filledWidth = Math.min(barWidth, Math.floor((percent / 100) * barWidth));
                        const bar = "█".repeat(filledWidth) + "░".repeat(Math.max(0, barWidth - filledWidth));

                        readline.moveCursor(process.stdout, 0, -3);
                        readline.clearLine(process.stdout, 0);
                        process.stdout.write(`${STYLES.bold}${STYLES.blue}${displayTitle}${STYLES.reset}\n`);
                        readline.clearLine(process.stdout, 0);
                        process.stdout.write(`${STYLES.blue}${percent}% ${STYLES.dim}${bar} ${STYLES.blue}100%${STYLES.reset}\n`);
                        readline.clearLine(process.stdout, 0);
                        process.stdout.write(
                            `${STYLES.blue}${(downloadedSize / (1024 * 1024)).toFixed(2)} / ${totalSizeMb} MB ${STYLES.dim}│${STYLES.reset} ` +
                            `${STYLES.blue}${(speed / (1024 * 1024)).toFixed(2)} MB/s ${STYLES.dim}│${STYLES.reset} ` +
                            `${STYLES.blue}${formatTime(remainingTime)}${STYLES.reset}\n`
                        );
                    });

                    finalRes.on('end', () => {
                        fileStream.end();
                        saveHistory(originalPageUrl, fileName);
                        process.stdout.write(`\n${STYLES.blue}Finished downloading ${STYLES.bold}${displayTitle}${STYLES.reset}\n\n`);
                        resolve();
                    });

                    finalRes.on('error', (e) => {
                        fileStream.destroy();
                        reject(e);
                    });
                }).on('error', reject);

            } else {
                // Pokud to pořád vrací 303, vypíšeme to pro debug
                reject(new Error(`Buzzheavier: Redirect link nenalezen. Status: ${res.statusCode}. Možná detekovali spoofing.`));
            }
        }).on('error', reject);
    });
}

async function main() {
    if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);
    if (!fs.existsSync('list.txt')) {
        console.log("Create list.txt first.");
        return;
    }
    const links = fs.readFileSync('list.txt', 'utf-8').split('\n').map(l => l.trim()).filter(l => l);

    console.clear();

    for (const pageUrl of links) {
        if (downloadHistory[pageUrl]) {
            const existingFile = path.join(DOWNLOAD_DIR, downloadHistory[pageUrl]);
            if (fs.existsSync(existingFile) && fs.statSync(existingFile).size === REQUIRED_SIZE) {
                process.stdout.write(`${STYLES.blue}${STYLES.dim}Skipping file: ${downloadHistory[pageUrl]}${STYLES.reset}\n`);
                continue;
            }
        }

        try {
            process.stdout.write(`${STYLES.blue}${STYLES.dim}Looking at: ${new URL(pageUrl).hostname}...${STYLES.reset}\n`);
            if (pageUrl.includes("fuckingfast.co")) {
                const html = await fetchText(pageUrl);
                console.log(html)
                const match = html.match(/window\.open\(['"](.+?)['"]\)/);
                process.stdout.write(`${STYLES.blue}${STYLES.dim}Scraped the URL: ${match[1] || ''}\n`)

                if (match && match[1]) {
                    await downloadFile(match[1], pageUrl);
                }
            }
            if (pageUrl.includes("buzzheavier.com")) {
                await downloadBuzzheavier(pageUrl, pageUrl)
            }
        } catch (e: any) {
            process.stdout.write(`\n${STYLES.blue}x chyba: ${e.message}${STYLES.reset}\n`);
        }
    }
}

main();