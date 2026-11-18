// Helpers for the help-screenshot harness (see shots.mjs, the entry
// point, for how to run it): a mocked backend, mobile browser context,
// numbered-callout overlay and screenshot writer.
//
// The app's /api/* calls are answered from the bundled sample data
// (fixtures.mjs), so no database or routing key is needed. Callouts
// (numbered red boxes) are drawn onto the page itself just before each
// capture - the matching numbered list is written in the Help content.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { buildFixtures, fakeGeometry } from "./fixtures.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:4601";
const OUT = join(process.cwd(), "public", "help");
mkdirSync(OUT, { recursive: true });
const ONLY = process.argv.slice(2);

const fx = buildFixtures();
const DEPOT = { latitude: 36.04227, longitude: -86.55312 };

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

async function newPage(extra = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    geolocation: DEPOT,
    permissions: ["geolocation"],
    ...extra,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  // Hide Next's dev-mode indicator badge.
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal{display:none!important}";
    document.addEventListener("DOMContentLoaded", () => document.head.append(style));
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/api/route-master-list") return json(fx.masterList);
    if (p === "/api/schools") return json(fx.schools);
    if (p === "/api/routes/steps") return json(fx.steps);
    if (p === "/api/saved-locations") return json(fx.savedLocations);
    if (p === "/api/location-suggestions") return json(["Bill Stewart Blvd", "Riverwood Dr", "Holland Ridge Dr", "Hidden Forest Ln"]);
    if (p === "/api/waypoints" && route.request().method() === "GET") return json(fx.waypoints);
    if (p === "/api/route-geometry") {
      const body = route.request().postDataJSON();
      return json(fakeGeometry(body.waypoints));
    }
    return json({ ok: true });
  });
  return page;
}

/** Draws numbered red callout boxes over the page. Each target is a
 * Playwright locator (or a {x,y,width,height} box in viewport px). */
async function callouts(page, targets) {
  const boxes = [];
  for (const t of targets) {
    const box = "boundingBox" in t.target ? await t.target.first().boundingBox() : t.target;
    if (!box) throw new Error(`callout ${t.n}: target not visible`);
    boxes.push({ n: t.n, pad: t.pad ?? 4, badge: t.badge ?? "tl", ...box });
  }
  await page.evaluate((items) => {
    document.getElementById("help-callouts")?.remove();
    const layer = document.createElement("div");
    layer.id = "help-callouts";
    layer.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    for (const b of items) {
      const r = document.createElement("div");
      r.style.cssText = `position:absolute;left:${b.x - b.pad}px;top:${b.y - b.pad}px;width:${b.width + b.pad * 2}px;height:${b.height + b.pad * 2}px;border:3px solid #e11d48;border-radius:12px;box-shadow:0 0 0 2px #fff,0 0 0 2px #fff inset;`;
      const n = document.createElement("div");
      const left = b.badge.includes("r") ? b.x + b.width + b.pad - 14 : b.x - b.pad - 12;
      const top = b.badge.includes("b") ? b.y + b.height + b.pad - 14 : b.y - b.pad - 14;
      n.textContent = String(b.n);
      n.style.cssText = `position:absolute;left:${Math.max(2, left)}px;top:${Math.max(2, top)}px;width:26px;height:26px;border-radius:50%;background:#e11d48;color:#fff;font:700 15px/26px system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff;`;
      layer.append(r, n);
    }
    document.body.append(layer);
  }, boxes);
}

async function shot(page, name, { clip, targets = [] } = {}) {
  if (ONLY.length && !ONLY.includes(name)) return;
  if (targets.length) await callouts(page, targets);
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(OUT, `${name}.png`), ...(clip ? { clip } : {}) });
  await page.evaluate(() => document.getElementById("help-callouts")?.remove());
  console.log("saved", name);
}

async function openApp(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.getByText("LaVergne Lake Elementary School").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
}

export { browser, newPage, openApp, shot, callouts, fx, DEPOT, BASE, OUT, ONLY };
