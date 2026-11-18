// Regenerates the screenshots used by the in-app Help screen
// (src/components/HelpScreen.tsx) into public/help/. Needs a dev server
// running (BASE_URL, default http://localhost:4601), Playwright with a
// Chromium, and runs through tsx:
//
//   npx next dev -p 4601 &
//   npx tsx scripts/help-screenshots/shots.mjs [shot-name ...]
import { browser, newPage, openApp, shot } from "./lib.mjs";

const btn = (page, name, exact = true) => page.getByRole("button", { name, exact });
// Regions of the driving screen (viewport px, 390x844).
const HEADER = { x: 12, y: 270, width: 366, height: 62 };
const STRIP = { x: 12, y: 344, width: 366, height: 58 };
const INSTRUCTION = { x: 24, y: 440, width: 342, height: 290 };
const MAP_CONTROLS = { x: 350, y: 10, width: 34, height: 70 };

async function driverShots() {
  const page = await newPage();
  await openApp(page);
  await shot(page, "route-list", {
    targets: [
      { n: 1, target: page.getByPlaceholder("Search routes") },
      { n: 2, target: { x: 205, y: 176, width: 180, height: 32 } },
      { n: 3, target: page.getByText("3:30 PM").first(), pad: 8 },
    ],
  });

  // Route 125 (PM drop-off) has stops with riders, sides and notes.
  await page.getByText("3:30 PM").first().click();
  await page.getByRole("button", { name: /start route/i }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  await shot(page, "start-screen", {
    targets: [{ n: 1, target: page.getByRole("button", { name: /start route/i }), badge: "tr" }],
  });

  await page.getByRole("button", { name: /start route/i }).click();
  await btn(page, "Start").waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  await shot(page, "depot", {
    targets: [
      { n: 1, target: INSTRUCTION },
      { n: 2, target: btn(page, "Start"), badge: "tr" },
      { n: 3, target: btn(page, "Routes").last() },
    ],
  });

  await btn(page, "Start").click();
  await page.waitForTimeout(2500);
  await shot(page, "driving-turn", {
    targets: [
      { n: 1, target: HEADER },
      { n: 2, target: STRIP },
      { n: 3, target: INSTRUCTION },
      { n: 4, target: btn(page, "Next"), badge: "tr" },
      { n: 5, target: btn(page, "Back") },
    ],
  });

  // Step to the first stop (5 steps in: 5 turns, then Hidden Forest Ln).
  for (let i = 0; i < 5; i++) {
    await btn(page, "Next").click();
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2500);
  await shot(page, "driving-stop", {
    targets: [
      { n: 1, target: INSTRUCTION },
      { n: 2, target: page.getByRole("button", { name: "Show riders" }), badge: "tr" },
    ],
  });

  await page.getByRole("button", { name: "Show riders" }).click();
  await page.waitForTimeout(1200);
  await shot(page, "rider-box", {
    targets: [
      { n: 1, target: { x: 40, y: 78, width: 330, height: 60 } },
      { n: 2, target: page.getByRole("button", { name: /add rider/i }) },
      { n: 3, target: page.getByRole("button", { name: /ok/i }).first(), badge: "tr" },
    ],
  });
  await btn(page, "Close").click();
  await page.waitForTimeout(800);

  await page.getByRole("button", { name: "Expand map to full screen" }).click();
  await page.waitForTimeout(5000);
  await shot(page, "map-expanded");
  await page.context().close();
}

async function menuAndAdminShots() {
  const page = await newPage();
  await openApp(page);
  const menu = page.getByRole("button", { name: "Driver account and permissions" });
  await menu.click();
  await page.waitForTimeout(600);
  await shot(page, "account-menu", {
    targets: [
      { n: 1, target: page.getByText("Log riders").first(), pad: 8 },
      { n: 2, target: page.getByText("Can edit").first(), pad: 8 },
    ],
  });
  await page.context().close();
}

async function adminShots() {
  const page = await newPage();
  await openApp(page);
  await page.getByRole("button", { name: /edit routes/i }).click();
  await page.waitForTimeout(900);
  await shot(page, "edit-mode", {
    targets: [
      { n: 1, target: page.getByRole("button", { name: "Filter by published status" }), pad: 6 },
      { n: 2, target: page.getByRole("button", { name: "Unpublish route 125" }), pad: 6 },
      { n: 3, target: page.getByRole("button", { name: "Add a new route" }) },
      { n: 4, target: page.getByRole("button", { name: "Download the route list as a CSV" }), badge: "tr" },
    ],
  });
  await page.getByText("3:30 PM").first().click();
  await page.waitForTimeout(1500);
  await shot(page, "edit-hub", {
    targets: [
      { n: 1, target: { x: 12, y: 192, width: 366, height: 236 }, pad: 0 },
      { n: 2, target: page.getByRole("button", { name: /reverse this route/i }) },
      { n: 3, target: page.getByRole("button", { name: /duplicate this route/i }) },
      { n: 4, target: page.getByRole("button", { name: "Edit Waypoints" }) },
      { n: 5, target: page.getByRole("button", { name: "Save", exact: true }), badge: "tr" },
    ],
  });
  await page.getByRole("button", { name: "Edit Waypoints" }).click();
  await page.waitForTimeout(1500);
  await shot(page, "waypoints", {
    targets: [
      { n: 1, target: page.getByRole("button", { name: /fetch coordinates/i }) },
      { n: 2, target: page.getByRole("button", { name: "Edit turn" }).first(), pad: 6 },
      { n: 3, target: page.getByRole("button", { name: "Reorder turn" }).first(), pad: 6 },
      { n: 4, target: page.getByRole("button", { name: "Add step here" }).nth(1), pad: 4 },
      { n: 5, target: page.getByRole("button", { name: "Split route here" }).first(), pad: 6 },
      { n: 6, target: page.getByRole("button", { name: /^Autoroute/ }).first(), pad: 6, badge: "tr" },
    ],
  });
  await page.getByRole("button", { name: "Edit turn" }).nth(1).click();
  await page.waitForTimeout(1500);
  await shot(page, "edit-waypoint", {
    targets: [
      { n: 1, target: { x: 44, y: 138, width: 108, height: 42 } },
      { n: 2, target: { x: 44, y: 208, width: 252, height: 42 } },
      { n: 3, target: { x: 258, y: 307, width: 40, height: 40 }, pad: 2 },
      { n: 4, target: { x: 306, y: 307, width: 40, height: 40 }, pad: 2, badge: "tr" },
      { n: 5, target: { x: 44, y: 396, width: 302, height: 42 } },
      { n: 6, target: page.getByRole("button", { name: "Save", exact: true }).first(), badge: "tr" },
    ],
  });
  await page.getByRole("button", { name: /manually place/i }).click();
  await page.waitForTimeout(3500);
  await shot(page, "place-pin", {
    targets: [
      { n: 1, target: { x: 190, y: 220, width: 10, height: 30 }, pad: 14 },
      { n: 2, target: page.getByRole("button", { name: "Override Once" }), badge: "tr" },
      { n: 3, target: page.getByRole("button", { name: /Update Every/ }), badge: "tl" },
    ],
  });
  await page.context().close();
}

try {
  await driverShots();
  await menuAndAdminShots();
  await adminShots();
} finally {
  await browser.close();
}
