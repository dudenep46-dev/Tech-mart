# TechMart Empire: Ultra Simulator

A lightweight, mobile-first shop-management game that runs in the browser.
Start as a tiny phone-repair stall, grow into a full tech supermarket.

- **Frontend:** HTML5 Canvas with a built-in dependency-free 3D renderer (perspective camera, shaded 3D props, animated 3D characters, 60 FPS cap, cached static scene, pooled NPCs), vanilla JS, no external libraries or CDNs (works offline and inside portals).
- **Backend:** Node.js + Express (static hosting, `/health`, `/api/save`, `/api/load`).
- **Deploy:** GitHub + Render.com (`render.yaml` blueprint included).

## Run locally

```bash
npm install
npm start
# open http://localhost:3000
```

Requires Node.js 18+. Set `PORT` and `SAVE_DIR` to override defaults.

## How to play

1. **Phone Market (Workbench ▸ Market):** buy broken phones. A *Scan* ($8) reveals every fault; otherwise you only see one reported symptom.
2. **Workbench:** run free diagnostics on a phone you own, then repair each fault. Each part has its own mini-game:
   - Screen: tap the cracks in order
   - Battery: stop the needle in the green zone (3 hits)
   - Mainboard: repeat the circuit pattern
   - Camera: drag the slider until the image is sharp, then capture
   - Speaker: tap fast to clear the dust
   Perfect runs add a quality bonus (up to +8% value). Failed attempts waste the part.
3. **Price and list:** set the resale price with the slider (demand % shows the odds a customer accepts). List it in a display case, quick-sell it to the trader (70%), or scrap it.
4. **Checkout:** customers queue at the counter. Tap **Checkout** (or the counter) to serve them, or hire cashiers to automate it. Cash is instant, digital payments take longer and cost a 1.5% fee.
5. **Supermarket (Shop ▸ Shelves):** unlock shelves for groceries (Lv1), tech accessories (Lv2) and appliances (Lv4). Tap a shelf on the map to jump to its settings and set its price markup.
6. **Inventory (Orders):** order stock in bulk (discounts on larger orders). Deliveries arrive after a short delay into the warehouse; hire stockers (or press *Restock shelves*) to fill the shelves.
7. **Expand:** bigger floor plans give more phone cases, more shelf slots and more customers.
8. **End of day:** a profit/loss report shows revenue, cost of goods, wages, rent and fees, plus a 7-day trend. Daily wages and rent are charged at close. If cash drops below -$1,500 the shop goes bankrupt.

The simulation pauses while the Workbench, Shop or Orders windows are open, so you can manage calmly.

## Project structure

```
techmart-empire/
├── package.json
├── server.js            Express server + save/load API
├── render.yaml          Render blueprint
├── .gitignore
├── README.md
└── public/
    ├── index.html       HUD, canvas, modals
    ├── style.css
    └── js/
        ├── main.js          boot, save/load glue, autosave
        ├── gameEngine.js    config, state, layout, pathfinding, customer AI, loop, input
        ├── render3d.js      3D scene renderer: camera, props, characters, picking
        ├── audio.js         synthesized sound effects + mute switch (no audio files)
        ├── mobileShop.js    market, diagnostics, repair mini-games, pricing, transactions
        ├── supermarket.js   shelves, ordering, employees, expansion
        └── uiController.js  HUD, modals, reports, events
```

## Performance notes

- Single `requestAnimationFrame` loop, capped at 60 FPS even on 120 Hz screens; delta time clamped and simulated in sub-steps.
- Static scenery (floor, walls, signage, lighting) is pre-rendered to an offscreen canvas and only rebuilt on layout/theme/resize changes. Props and people are depth-sorted every frame with a reused array (no allocation).
- Character motion: render positions are low-pass filtered, so the 4-direction pathing never looks jerky; walk cycle is driven by distance travelled, heading is smoothed.
- Customers are a fixed pool (48) that is recycled, so there is no per-customer allocation churn during play.
- Pathfinding uses cached BFS flow-fields per destination (one field serves every customer heading to the same spot) and is invalidated only when the layout changes.
- HUD DOM updates are throttled and only touch changed values.

## Save system

The game autosaves every 20 seconds, at the end of every day and when the tab is hidden. Saves go to `localStorage` and to the server (`/api/save`), keyed by a random player id stored in the browser. On load, the newer of the two is used.

## Deploy to Render

1. Push this folder to a GitHub repository.
2. In Render choose **New ▸ Blueprint** and select the repo (it reads `render.yaml`), or create a **Web Service** manually with build command `npm install` and start command `npm start`.
3. Health check path: `/health`.

On Render's free plan the disk is ephemeral, so server-side saves can reset on redeploy. The browser copy keeps progress safe. For permanent server saves use a paid plan, add a disk (see the comment in `render.yaml`) and point `SAVE_DIR` at it.

## API

| Method | Route | Body / Query | Description |
| --- | --- | --- | --- |
| GET | `/health` | | Returns `{ status: "ok" }` |
| POST | `/api/save` | `{ playerId, state }` | Stores the save (max 512 KB) |
| GET | `/api/load` | `?playerId=...` | Returns `{ ok, savedAt, state }` or 404 |

`playerId` must match `[A-Za-z0-9_-]{8,64}`.

## Publishing on CrazyGames

The game is portal-ready: it needs no backend and no external requests except the optional CrazyGames SDK.

- Upload the contents of `public/` (zip with `index.html` at the root). Total size is about 0.2 MB, far below the 50 MB initial-download limit.
- All paths are relative. The SDK script is loaded from `sdk.crazygames.com`; if it is missing (local run, Render, ad-blocker) the game simply runs standalone.
- SDK hooks (`js/main.js`, `TM.Platform`): `init`, `loadingStart/Stop`, `gameplayStart/Stop` (only while the sim is actually running, not in menus/modals/hidden tab), `happytime` on level-up, and the Data module for saves (localStorage fallback). Server saves are skipped automatically on CrazyGames.
- No ads are implemented, so the basic launch has nothing to configure. Add `SDK.ad.requestAd(...)` at natural breaks (e.g. the end-of-day report) for full launch.
- Audio starts only after the first tap/click and is suspended when the tab is hidden.
- CrazyGames decides on approval; test the build in their Developer Portal preview before submitting.
