# chuan.ma · Learn Sichuan Mahjong

**A free, no-signup way for non-Chinese players to learn 川麻 — Sichuan mahjong (四川麻将, 血战到底).**

There is plenty of English material on Cantonese and Japanese mahjong. There is almost nothing on the Sichuan game, which is faster, harsher and structurally different from both. This project exists to close that gap: basic rules, tile recognition and fan scoring taught in English, backed by a real rules engine so that a learner can practise against something that actually scores like a table would.

Everything is a **static web page**. No signup, no ads, no server, no account, nothing to install. The coaching and the scoring come from a deterministic TypeScript engine — never from a language model guessing.

---

## Play it now

| | |
|---|---|
| **Start here** | <https://kyloeworks.github.io/chuan.ma/> |
| Play a game (GPU table) | <https://kyloeworks.github.io/chuan.ma/play.html> |
| Hand calculator | <https://kyloeworks.github.io/chuan.ma/calculator.html> |
| Glossary | <https://kyloeworks.github.io/chuan.ma/glossary.html> |

![The Sichuan mahjong table](docs/screenshot-play.png)

---

## The learning path

Four short lessons, in order. Each one assumes nothing.

| # | Lesson | What it covers |
|---|---|---|
| 1 | [**How to Play**](learn-rules.html) · 基础规则 | The 108-tile deck, declaring your **missing suit** (定缺), turn order, pong / kong / win, and how a round ends — including why the round keeps going after somebody wins. |
| 2 | [**Reading the Tiles**](learn-tiles.html) · 识别牌型 | Three suits 万 条 筒, the nine Chinese numerals, and the one tile that is drawn as a bird instead of a number. |
| 3 | [**Scoring & Fan**](learn-scoring.html) · 计算番数 | The fan table, how pattern bonuses stack, who pays on a self-draw versus a discard, kong money, and three worked examples. |
| 4 | [**Culture & Variants**](learn-culture.html) · 麻将文化 | Where the game comes from, the teahouse table, table etiquette, and the variants you will actually meet. |

Then practise:

- **[The table](play.html)** — a four-player game against three opponents, rendered on the GPU. A coaching strip along the bottom always tells you how many tiles you are from ready, which tiles you are waiting on and how many are left, which tile to discard **and why**. Three difficulty levels, and a full scoring breakdown at the end of every round.
- **[The calculator](calculator.html)** — click in any hand and instantly see its shanten, its waits, the tiles that would improve it, and the best discard. The fastest way to build intuition for hand shape.
- **[Glossary](glossary.html)** — every term in English and Chinese with pinyin, because discards are announced in Chinese at a real table.

---

## What makes Sichuan mahjong different

| It has | It does **not** have |
|---|---|
| Only **108 tiles** — three suits, nothing else | No winds, no dragons, no flowers |
| A mandatory **missing suit** you must discard entirely (定缺) | No chow (吃) — you can never claim a discard to make a run |
| **Battle to the end**: up to **three** winners per round (血战到底) | No stopping at the first winner |
| Penalties for stalling: ready check, flower pig, tax refund | No safe, patient way to sit a round out |

With the honours stripped out, essentially the whole game is about **shape efficiency** — how fast you turn 13 random tiles into a winning hand. That is what makes it both unforgiving and unusually learnable.

---

## Repository layout

```
.
├── index.html            # site entry — start here
├── learn-rules.html      # lesson 1 · the basics
├── learn-tiles.html      # lesson 2 · tile recognition
├── learn-scoring.html    # lesson 3 · fan and points
├── learn-culture.html    # lesson 4 · culture and variants
├── glossary.html         # English ↔ Chinese term list
├── play.html             # the table (GPU, PixiJS) — self-contained, ~1.8 MB
├── calculator.html       # shanten / waits / best-discard trainer
├── tiles.html            # every tile face as vector artwork
├── site.css              # shared stylesheet for the lesson pages
│
├── kernel/               # the rules engine (TypeScript, zero dependencies)
│   ├── src/              #   tiles · shanten · ukeire · win · scoring · flow · bot · settle
│   └── test/             #   unit tests + verification harnesses
│
├── web/                  # page sources and build tooling
│   ├── content/          #   lesson page sources + shared CSS
│   ├── *.template.html   #   tool page templates
│   ├── *.js              #   page scripts and tile artwork
│   ├── build.mjs         #   bundles a page + the engine into one HTML file
│   └── publish.mjs       #   copies web/dist/ to the repository root
│
└── docs/screenshot-play.png
```

The three tool pages (`play.html`, `calculator.html`, `tiles.html`) are **fully self-contained single files** — engine, styles and artwork inlined. You can download one and open it offline with no server.

---

## Run it locally

The published pages have no build step — just serve the folder:

```bash
python -m http.server 8791     # then open http://127.0.0.1:8791/
```

## Build from source

Requires Node 22.6+ (the engine is TypeScript and the tests run through Node's type stripping).

```bash
npm install                    # esbuild + pixi.js (only needed to rebuild pages)
npm run build                  # web/dist/  — bundle engine + PixiJS into each page
npm run publish                # copy web/dist/ to the repository root (the site root)
npm run serve                  # local preview on :8791
```

## Tests

The engine is the part worth trusting, so it is tested hard. All of it runs on plain Node with no test framework:

```bash
npm test                       # kernel unit tests + page smoke tests
npm run verify                 # 20k-hand independent cross-check of shanten + invariant fuzzing
npm run sim                    # 400 headless full games
npm run winrate                # seat fairness and difficulty measurement
npm run probe                  # real-browser check of the table (needs Chrome)
```

| Suite | What it proves |
|---|---|
| `kernel/test/*.test.ts` | Winning shapes, fan composition, turn flow, settlement arithmetic |
| `verify_shanten.ts` | The shanten number matches a separately written reference implementation over tens of thousands of hands |
| `fuzz.run.ts` | Invariants hold over random hands (tile counts conserved, no illegal states) |
| `sim.run.ts` | Thousands of full games complete with no deadlocks or rule violations |
| `winrate.run.ts` | Seat fairness and the strength of each difficulty tier, on paired deals |
| `browser-probe.mjs` + `pixel-audit.mjs` | The rendered table in a real browser: layout inside the canvas, seat orientation, animation counters, zero script errors — plus a pixel-level check that the left and right hands really are rotated |

---

## The rules engine

The lessons and the tools are driven by the same engine, so a lesson can never disagree with a score:

| Module | Responsibility |
|---|---|
| `tiles` | Tile encoding, suit/rank helpers, labels |
| `shanten` | Distance to a winning hand |
| `ukeire` | Which tiles improve the hand, and which complete it |
| `win` | Legal winning shapes — standard, seven pairs |
| `scoring` | Fan composition (平胡 · 碰碰胡 · 清一色 · 七对 · 龙七对 · 根 · 自摸 · 杠上花 · 杠上炮 · 海底 · 金钩钓) |
| `flow` | Declaring the missing suit, draws, discards, claims, kong handling, battle-to-the-end |
| `bot` | Three opponent personalities (easy / normal / hard) |
| `settle` | Points, kong accounting, ready check (查大叫), flower pig (查花猪), tax refund (退税) |

## Ruleset, and how much to trust it

Sichuan mahjong fan values genuinely differ from table to table and city to city — all-one-suit is worth 2 in some places and 4 in others, and rare fan *names* shift too. This project therefore documents **one clearly specified preset** rather than claiming to be authoritative, and the site states its values openly on the [scoring page](learn-scoring.html) so you can compare them with your local table's house rules.

Where this repository is strict is **internal consistency**: the engine, the table, the calculator and the lessons all compute the same way, and the test suite pins that down.

---

## Deployment

The site is plain static files served from the repository root, published by the included workflow (`.github/workflows/pages.yml`) on every push to `main`.

Live at <https://kyloeworks.github.io/chuan.ma/>.

> **One-time setup note.** A brand-new repository's `GITHUB_TOKEN` is read-only by default, which caps the `pages: write` permission declared in the workflow and makes `actions/configure-pages` fail with `Resource not accessible by integration`. Fix it once under *Settings → Actions → General → Workflow permissions → **Read and write***.

### Attaching a custom domain

> ⚠️ **Order matters.** Do **not** enter a custom domain, and do not commit a `CNAME` file, until that domain's DNS actually resolves. The moment a custom domain is attached, GitHub Pages starts redirecting the working `*.github.io` URL to it — so pointing it at a domain that does not resolve takes the site offline entirely.

1. **First confirm the domain is live.**
   ```powershell
   Resolve-DnsName -Name <domain> -Type NS
   Resolve-DnsName -Name <domain> -Type A
   ```
   Real name servers and A records mean you can proceed. If you get something like `suspended1.<registrar>.net`, the domain is suspended at the registrar and nothing can be attached — that is a registrar problem, not a GitHub one.
2. **Point DNS at GitHub Pages.** Four `A` records on the apex domain:
   `185.199.108.153` · `185.199.109.153` · `185.199.110.153` · `185.199.111.153`
   plus, optionally, the matching `AAAA` records, and a `CNAME` for `www` pointing at `<owner>.github.io`.
3. **Tell Pages about it.** *Settings → Pages → Custom domain* → enter the domain → **Save**, wait for the DNS check to pass, then tick **Enforce HTTPS**.

**To remove a custom domain**, clear the *Custom domain* field and save — **deleting the `CNAME` file from the repository is not enough**, because the settings field and the file are two separate places. Browsers also cache the `301` to a former domain permanently, so verify the removal in a private window.

## Licence

No open-source licence is declared — all rights reserved. If you would like to use this under MIT or similar, please open an issue.

## 中文说明

本项目的定位是**面向非中文使用者的川麻教学工具**：从基础规则、识别牌型到计算番数，成体系地用英文讲一遍川麻（血战到底），并提供一个带教学提示的 GPU 牌桌让你真的打得起来。

站点为纯静态页面，规则与提示全部来自自研 TypeScript 规则引擎（无 AI 参与判牌）。番值等存在地区差异的参数集中在一处并公开说明，站点内自洽；同时只保留**一个**牌桌（`play.html`）持续打磨视觉与手感。
