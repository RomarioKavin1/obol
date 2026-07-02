# Obol — 60-Second Explainer

A one-minute, story-driven film. Every shot is buildable in **Remotion** with plain
typography, SVG paths, CSS gradients, and spring/interpolate motion. No 3D, no stock
footage, no external assets.

> **The through-line (one sentence):** In myth, the *obol* was the coin you carried to
> pay your passage across the river of the dead. Obol Protocol carries your crypto
> across the same threshold — to the heir you chose — provably, privately, and only if
> you're truly gone.

---

## 0. Positioning — what this video must land

The old cut described the problem and the mechanic. This cut is built around **three
arguments**, in order, because "why us" is the part judges/viewers actually remember:

1. **Every existing fix fails the same way.** A lawyer means trusting a person. A
   custodian means a third party holds the risk. A plain on-chain will means the whole
   world reads it. We *show* each one failing (Scene 2) instead of skipping straight to
   the solution.
2. **Obol is the only shape that leaks nothing and trusts no one.** No wallet signature
   ever touches a check-in — the chain never links you to the arrangement. The heir is
   sealed until the moment of claim, and the claim is bound to their address so it
   can't be front-run. These are shown as *visual mechanics*, not bullet points.
3. **It's real, not a deck.** Live contracts on Stellar testnet, a real 14,592-byte
   UltraHonk proof verified on-chain, browser-generated proofs accepted. The tx hash
   goes on screen (Scene 6). Nobody else's demo video can type a receipt.

The competitive picture the film dramatizes:

| | Lawyer / will | Custodial service | Naive on-chain switch | **Obol** |
|---|---|---|---|---|
| Trust required | a person | a company | none | **none** |
| Owner's wallet exposed | yes | yes | **yes — every check-in signs** | **never** |
| Heir visible before claim | yes | yes | yes | **sealed** |
| Claim front-runnable | n/a | n/a | often | **bound to heir's address** |
| Verifiable it works | no | no | maybe | **on-chain, today** |

The "naive on-chain switch" column is the sharpest edge: a dead-man's switch without ZK
*doxxes you with every heartbeat*. That contrast is the pivot of the whole film
(end of Scene 2 → Scene 3).

---

## 1. Theme & visual language

Reuse the app's identity exactly so the video and product feel like one object.

**Mood:** solemn, monumental, cryptographic. A carved monument meets a ledger.
Not "crypto neon." Quiet, then a single warm glint of bronze.

**Color (OKLCH — same tokens as the app):**
| Role | Value | Use |
|---|---|---|
| Background | `oklch(0.135 0.006 74)` | warm near-black, the whole canvas |
| Foreground | `oklch(0.955 0.006 86)` | "bone" off-white text |
| Accent (the obol) | `oklch(0.74 0.11 72)` | bronze — used sparingly, the emotional beat |
| Muted | `oklch(0.6 0.009 74)` | labels, secondary text |
| Hairline | `oklch(0.27 0.009 74)` | 1px rules, grid, rings |
| Alarm | `oklch(0.63 0.2 25)` | the flatline / failed fixes / "switch tripped" |

**Type:**
- Display: **Archivo** (700–900), tight tracking, UPPERCASE for hero words.
- Labels/kickers: a mono (Geist Mono / JetBrains Mono), letterspaced `0.2em`,
  like `// PROOF OF LIFE`, `[01]`, `SIGNATURE: NONE`.
- Cap body lines short; hierarchy through scale + weight, not color.

**Signature motifs (all animatable):**
- **The obol coin** — a bronze disc (radial gradient), engraved `ΟΒΟΛΟΣ`, a large `Ω`,
  and `MMXXVI`. A slow shine sweep.
- **Heartbeat / pulse line** — an SVG path that pulses, then flatlines.
- **Concentric rings** — the anonymity set / Merkle tree, faint hairline circles.
- **The vault** — a stark square with a single seam and a small keyhole; it "seals,"
  later it "opens."
- **The three doors** — three tall hairline rectangles (lawyer / custodian / on-chain
  will), each stamped with its failure in alarm red. New motif, carries Scene 2.
- **A coin on a path** — the inheritance transfer, a bronze dot gliding a bezier curve.
- **The receipt** — a mono tx hash typing on, then a bronze `VERIFIED` stamp. New
  motif, carries Scene 6.
- **Ticker** — a thin marquee: `MEMENTO MORI · TRUSTLESS EXECUTION ·`.

**Motion principles:**
- Ease **out** with exponential curves (`Easing.out(Easing.exp)` / quint). No bounce,
  no elastic.
- Staggered reveals (60–90ms apart). One dominant idea per beat.
- Film grain overlay at ~4% opacity, `mix-blend-mode: overlay`, for texture.
- Cut on the beat of the music; let silences breathe.

**Aspect:** 1920×1080, 30fps (1800 frames). A 1080×1920 vertical variant is trivial
(reflow the type stacks; the coin stays centered).

---

## 2. The story spine (why each beat exists)

| Beat | Feeling | Job |
|---|---|---|
| 1. Flatline | dread | Hook: a person just died. Their crypto died with them. |
| 2. Three doors fail | frustration | **Differentiation**: every existing fix trusts someone or exposes everyone. |
| 3. The coin | hope | Obol enters as the answer to the *specific* failures we just watched. |
| 4. Proof of life | wonder | The mechanic — and the killer detail: `SIGNATURE: NONE`. The chain never learns who you are. |
| 5. The switch & the sealed heir | resolution | Death → vault opens → coin crosses to an heir nobody could see and nobody can front-run. |
| 6. The receipt | credibility | It's live. A real proof, a real tx hash, on Stellar testnet. |
| 7. The crossing | catharsis | Myth closes the loop. Wordmark. |

Problem (1) → why nothing else works (2) → Obol (3) → how (4–5) → proof it's real (6)
→ meaning (7). The old cut spent 24s on the problem and 0s on receipts; this cut spends
17s on problem + failed alternatives and gives 7 full seconds to the on-chain receipt.

---

## 3. Storyboard (7 scenes / 60s)

Times are `mm:ss`; frame ranges at 30fps in brackets. Each scene lists **VISUAL**,
**MOTION**, **ON-SCREEN**, **VO**, and **SFX** so the edit, the voice session, and the
sound pass can be built independently.

### Scene 1 — The flatline (0:00–0:07) `[0–210]`
- **VISUAL:** Black-warm canvas. A bronze **heartbeat line** draws across center,
  pulsing steadily. A tiny mono readout ticks `STATUS: ALIVE`. On the 4th pulse it
  **flatlines** — the peak collapses, the stroke lerps bronze → alarm, the readout
  snaps to `STATUS: —`.
- **MOTION:** SVG `strokeDashoffset` reveal (Easing.out.exp); pulse peaks driven by a
  sine; on flatline, peak height springs to 0 (low stiffness, no overshoot). Grain
  fades in.
- **ON-SCREEN:** big Archivo lands with the flatline, staggered: **`NOT STOLEN.`**
  then **`LOST.`**
- **VO:** "Every year, billions in crypto die with their owners. Not stolen — lost."
- **SFX:** low sub-bass drone; soft monitor "beep" per pulse; the beep stretches into
  a thin flat tone that hangs under the next scene.

### Scene 2 — Three doors, three failures (0:07–0:17) `[210–510]`
*The differentiation beat. Don't rush it — this is why Obol exists.*
- **VISUAL:** The flat tone line fades. Three tall hairline **door** rectangles slide
  up in a row, each with a mono label. One by one, each door "fails" with its own
  visual gag:
  1. `A LAWYER` — a small human glyph appears behind the seam; an alarm stamp slams
     across it: **`TRUST REQUIRED`**.
  2. `A CUSTODIAN` — a keyhole appears on the door, then a second, then a third
     (keys multiplying = someone else holds them); stamp: **`THEIR KEYS, NOT YOURS`**.
  3. `AN ON-CHAIN WILL` — the door turns transparent; behind it the heir's name and
     the amounts render in plain mono for all to see; faint broadcast rings ripple
     outward; stamp: **`PUBLIC TO EVERYONE`**.
- **MOTION:** doors rise staggered (90ms); each stamp scales 1.15→1 with a hard cut,
  slight 2° rotation, alarm color; the third door's transparency is an opacity lerp
  revealing scrolling mono "will" text behind it.
- **ON-SCREEN:** the three labels + three stamps, then a closing line, Archivo,
  centered as the doors dim: **`EVERY FIX TRUSTS SOMEONE — OR EXPOSES EVERYONE.`**
- **VO:** "The old fixes all fail the same way. Hand your keys to a lawyer — now you
  trust a person. A custodian — now a company is the risk. A will on the blockchain —
  now the whole world can read it."
- **SFX:** three distinct alarm stamps — dry rubber-stamp thunks, each slightly lower
  in pitch; a faint paper/static rustle behind the transparent third door; the drone
  darkens.

### Scene 3 — Obol appears (0:17–0:24) `[510–720]`
- **VISUAL:** Everything clears to black. The **obol coin** rises from below center
  and settles, shine sweep. Faint **concentric rings** bloom outward behind it. The
  three failure stamps from Scene 2 flicker once around the coin and dissolve —
  visually answered.
- **MOTION:** coin: `translateY(60→0)` + `scale(0.86→1)` + opacity on Easing.out.exp;
  rings expand and fade (staggered); stamps dissolve with a 4-frame scramble-out.
- **ON-SCREEN:** mono kicker under the coin:
  `// A ZERO-KNOWLEDGE DEAD MAN'S SWITCH · ON STELLAR`
- **VO:** "Obol is different. A dead man's switch — with zero knowledge."
- **SFX:** a single warm, resonant coin chime — the first "bright" sound in the film.
  Music lifts from drone to a warm pad.

### Scene 4 — Proof of life, nothing revealed (0:24–0:35) `[720–1050]`
*The mechanic + the sharpest differentiator: no wallet ever touches this.*
- **VISUAL:** The coin shrinks to a small bronze node among many faint nodes inside
  the **rings** (the anonymity set — one glow among a crowd). A pulse returns. Each
  pulse emits a tiny mono token `H(nullifier, epoch)` that flies up and dissolves.
  To the side, a fixed mono readout — the receipt of what the chain sees:
  ```
  WALLET:     UNLINKED
  SIGNATURE:  NONE
  IDENTITY:   ZERO-KNOWLEDGE
  PROOF:      ✓ VERIFIED
  ```
  The `✓ VERIFIED` line re-ticks with every pulse. Nothing about the glowing node
  distinguishes it from its neighbors.
- **MOTION:** every ~1s a check-in ripple travels the ring; a hashed-token particle
  emits and fades; the readout lines type on once and the check mark re-stamps per
  pulse (scale 1.2→1, 4 frames).
- **ON-SCREEN:** kicker: `// PROOF OF LIFE` · sub-label: `ONE ANONYMOUS PROOF PER
  EPOCH — UNREPEATABLE, UNLINKABLE TO YOUR WALLET`
- **VO:** "While you're alive, you check in with a zero-knowledge proof — generated in
  your browser, verified by a Stellar smart contract. No wallet. No signature. No
  identity. The chain learns exactly one thing: someone registered is still alive."
- **SFX:** soft "tick" per check-in; a faint sub-thump when `✓ VERIFIED` stamps;
  the pad holds warm and steady — this is the safe part of the film.

### Scene 5 — The switch trips, the coin crosses (0:35–0:47) `[1050–1410]`
- **VISUAL:** The pulses **stop**. Silence. A three-tick counter fills in alarm color:
  `MISSED 1 · 2 · 3`. On the third tick, the **vault seam splits open** and the bronze
  coin lifts out, glowing. It **glides along a bezier path** rightward toward a
  silhouetted heir marker whose tag reads `••••••••`. Only on arrival does the tag
  **descramble** to `→ HEIR`, and a small bronze lock closes around the pair with a
  mono footnote: `CLAIM BOUND TO THIS ADDRESS — FRONT-RUN-PROOF`.
- **MOTION:** counter fills with hard cuts; vault opens on a no-overshoot spring; coin
  travels the curve via `getPointAtLength`; the sealed tag character-shuffles into
  `→ HEIR` on arrival; the lock closes with a 3-frame snap.
- **ON-SCREEN:** `MISSED: 3 / 3` → `VAULT ACTIVATED` → (at arrival) `SEALED UNTIL
  THIS MOMENT`
- **VO:** "Go silent long enough, and the switch trips. Your vault opens — for one
  sealed heir no one could see coming, and no one can front-run."
- **SFX:** ticks per missed interval over near-silence; a low swell + latch release as
  the vault opens; a gliding whoosh for the crossing; a soft metallic click as the
  claim lock closes.

### Scene 6 — The receipt (0:47–0:54) `[1410–1620]`
*The credibility beat. This is footage nobody with a mockup can shoot.*
- **VISUAL:** Cut to near-black. A mono block types on, terminal-cadence, cursor
  blinking:
  ```
  NETWORK    STELLAR TESTNET · LIVE
  PROOF      ULTRAHONK · 14,592 BYTES · GENERATED IN-BROWSER
  TX         2f4083e8…2668ae72
  ```
  Then a bronze **`VERIFIED ON-CHAIN`** stamp lands across the block — same stamp
  language as Scene 2's failures, but bronze instead of alarm: the visual rhyme is
  the argument.
- **MOTION:** typewriter reveal per line (fast, 2 frames/char); the stamp scales
  1.15→1 with the same hard cut as Scene 2 — deliberately identical motion, opposite
  color.
- **ON-SCREEN:** small mono footer: `NO ORACLE · NO CUSTODIAN · NO TRUST REQUIRED`
- **VO:** "And this isn't a pitch. It's live — real proofs, verified on-chain, today.
  No oracle, no custodian, no trust required."
- **SFX:** dry keystrokes under the typing; one final resonant stamp — warmer and
  deeper than the alarm stamps, the sound of the argument closing.

### Scene 7 — The crossing / payoff (0:54–1:00) `[1620–1800]`
- **VISUAL:** Pull back. The coin settles center; the rings dim; the wordmark
  assembles: **`ΟΒΟΛΟΣ`** small, **`OBOL.`** large. The `MEMENTO MORI` ticker slides
  once across the bottom. End on the coin + wordmark, one last slow shine.
- **MOTION:** wordmark letters rise and lock (stagger, Easing.out.exp); ticker
  marquee; final shine sweep; grain gently fades.
- **ON-SCREEN:**
  - Line 1 (Archivo): **`SOME LEGACIES ARE MEANT TO STAY QUIET.`**
  - Kicker (mono): `ZK INHERITANCE · LIVE ON STELLAR TESTNET`
  - CTA (mono, small): `obol` · `github.com/<you>/obol`
- **VO:** "In myth, the obol paid your passage across. This one carries your legacy."
- **SFX:** resolve chord; the coin chime returns one last time; tail into silence.

---

## 4. Voiceover script (clean, ~140 words / ~58s)

Numbers in brackets mark scene starts — hand this to the edit as sync points.

> [1] Every year, billions in crypto die with their owners. Not stolen — lost.
> [2] The old fixes all fail the same way. Hand your keys to a lawyer — now you trust
> a person. A custodian — now a company is the risk. A will on the blockchain — now
> the whole world can read it.
> [3] **Obol is different.** A dead man's switch — with zero knowledge.
> [4] While you're alive, you check in with a zero-knowledge proof — generated in your
> browser, verified by a Stellar smart contract. No wallet. No signature. No identity.
> The chain learns exactly one thing: someone registered is still alive.
> [5] Go silent long enough, and the switch trips. Your vault opens — for one sealed
> heir no one could see coming, and no one can front-run.
> [6] And this isn't a pitch. It's live — real proofs, verified on-chain, today. No
> oracle, no custodian, no trust required.
> [7] In myth, the obol paid your passage across. This one carries your legacy.

**Tone:** calm, low, unhurried — a narrator at a memorial, not a hype ad. The only
lines with any lift are "Obol is different" and "It's live."

**Pauses that matter (bake them into the read):**
- ~0.5s after "Not stolen — lost." (let the flatline hang)
- ~0.4s before "Obol is different." (the turn)
- ~0.5s after "…no one can front-run." (silence before the receipt)
- ~0.4s before "In myth…" (the final breath)

**ElevenLabs delivery notes** (for the `video/.env` key):
- Voice: a low, warm, measured narrator; avoid anything "announcer."
- Settings: stability ~0.55, similarity ~0.75, style low (~0.15) — steadiness over
  drama; the visuals carry the drama.
- Encode the pauses explicitly with `<break time="0.5s" />` tags at the four points
  above rather than trusting punctuation.
- Generate per-scene clips (7 files) instead of one take — far easier to sync each
  `<Sequence>` and re-roll a single line.
- Emphasis targets: "*lost*", "*different*", "*one thing*", "*sealed*", "*live*".

---

## 5. Sound design

- **Music:** one sustained minor drone through Scenes 1–2 (darkening under the three
  failures), a warm pad enters with the coin chime at Scene 3, holds steady through
  Scene 4, thins to near-silence for the missed ticks in Scene 5, swells for the
  crossing, resolves at Scene 7. Nothing percussive/EDM.
- **SFX cue sheet:**
  | Cue | Scene | Sound |
  |---|---|---|
  | Pulse beeps → flat tone | 1 | soft monitor beep ×4, stretching into a thin sustained tone |
  | Failure stamps ×3 | 2 | dry rubber-stamp thunks, descending pitch |
  | Coin chime | 3, 7 | single warm resonant bell — the only "bright" sound |
  | Check-in ticks + verify thumps | 4 | soft tick per pulse; sub-thump per `✓ VERIFIED` |
  | Missed ticks | 5 | three dry ticks over near-silence |
  | Vault open | 5 | low swell + latch release |
  | The crossing | 5 | gliding whoosh; soft metallic click on the claim lock |
  | Receipt typing + verified stamp | 6 | dry keystrokes; one deep bronze stamp (warmer than Scene 2's) |
  | Resolve | 7 | resolve chord, chime, tail to silence |
- **Mix:** duck music under VO; the coin chime is the only bright sound — it marks
  hope. Silence is a tool: use it at the flatline, before the receipt, and before
  "In myth."
- **The stamp rhyme is a mix note too:** Scene 2's three stamps are dry and dead;
  Scene 6's `VERIFIED` stamp is the same gesture with body and warmth. Same sound
  family, opposite feeling — that's the argument in audio.

---

## 6. Remotion implementation notes

**Project skeleton**
```
src/
  Root.tsx                 // registerRoot; <Composition id="ObolFilm" fps={30}
                           //   durationInFrames={1800} width={1920} height={1080}/>
  ObolFilm.tsx             // <AbsoluteFill> + <Sequence> per scene + <Audio>
  theme.ts                 // the OKLCH tokens above, fonts, easings
  components/
    Grain.tsx              // fixed noise overlay, opacity .04, blend overlay
    PulseLine.tsx          // SVG heartbeat: strokeDasharray/offset + flatline flag
    ObolCoin.tsx           // bronze disc (radial-gradient) + Ω/ΟΒΟΛΟΣ + shine sweep
    Rings.tsx              // N concentric <circle>, staggered scale/opacity
    Vault.tsx              // square + seam + keyhole; props: locked | open
    Doors.tsx              // Scene 2: three hairline rects + Stamp children
    Stamp.tsx              // scale 1.15→1 hard-cut stamp; props: color (alarm|bronze)
    Readout.tsx            // Scene 4: mono key/value block, re-ticking check mark
    Receipt.tsx            // Scene 6: typewriter mono block + Stamp
    CoinTravel.tsx         // dot animated along an SVG path (getPointAtLength)
    Kicker.tsx / Display.tsx  // mono label + Archivo headline with stagger
    Ticker.tsx             // marquee row
    Scramble.tsx           // descramble text on reveal (sealed heir tag, stamp-outs)
  scenes/Scene1..7.tsx
  audio/  vo/scene1..7.mp3  music.mp3  sfx/*.mp3
```

**Core patterns**
- Timing: derive everything from `useCurrentFrame()`; wrap scenes in
  `<Sequence from={F} durationInFrames={D}>` using the frame ranges above.
- Reveals: `interpolate(frame, [0, 12], [0, 1], {extrapolateRight: 'clamp', easing: Easing.out(Easing.exp)})`.
- Physical settles (coin, vault): `spring({frame, fps, config: {damping: 200,
  stiffness: 100, mass: 0.8}})` (no overshoot).
- Pulse line: animate `strokeDashoffset` from `len → 0` to "draw"; drive the peak
  height with `Math.sin(frame/…)`; on flatline set peak height → 0 and lerp stroke
  color foreground → alarm.
- Stamps: two-keyframe scale (1.15 → 1 over 3 frames, no easing — the hard cut *is*
  the effect) + a 2° static rotation; reuse the identical component in Scenes 2 and 6
  with only the color prop changed.
- Typewriter (Scenes 2 will-text & 6 receipt): slice the string by
  `Math.floor(frame / 2)` chars; blink the cursor with `frame % 20 < 10`.
- Coin shine: a rotated linear-gradient bar with `backgroundPosition` animated, or a
  masked highlight sweeping `translateX(-100% → 200%)` on a loop.
- Coin travel: get an SVG `<path>` ref, `path.getPointAtLength(t*path.getTotalLength())`
  where `t = interpolate(frame, [a,b],[0,1])`; position an absolute dot at that point.
- Staggered words: map over words, each with `delay = i * 3` frames.
- Fonts: `@remotion/google-fonts/Archivo` + a mono; `delayRender`/`continueRender`
  until loaded, or preload in Root.
- Grain: inline the SVG `feTurbulence` data-URI (same one used in the app's
  `globals.css .bg-noise`) as a full-frame `<AbsoluteFill>` overlay.
- Audio: one `<Audio>` per scene VO clip inside its `<Sequence>`; layer music + sfx as
  separate `<Sequence><Audio/></Sequence>` blocks aligned to the frame ranges. Export
  `--codec=h264 --crf=18`.

**Reuse from the product (keeps it on-brand & fast):**
- The coin gradient + shine and the noise overlay are already defined in
  `frontend/src/app/globals.css` (`.obol-coin`, `.bg-noise`) — copy those values into
  `ObolCoin.tsx` / `Grain.tsx`.
- The palette + Archivo/mono pairing come straight from the app tokens.
- The Scene 6 tx hash is real: `2f4083e8b52c05fb3b6d6e278fbdabe47749d7fa16952a40b27cc7612668ae72`
  (see `deployments/testnet.json`). Truncate on screen as `2f4083e8…2668ae72`.

---

## 7. Substitutions if you want it even simpler

- Scene 2's three door gags can collapse to three mono lines each struck through
  (lawyer / custodian / on-chain will) — keep the three stamps' *labels* though; the
  failure reasons are the differentiation.
- Replace the bezier coin-travel (Scene 5) with a straight left→right glide.
- Scene 4's readout can be static (type on once, no re-ticking check mark).
- Skip music; a drone + the coin chime + VO is enough for a somber, premium feel.
- **Do not cut Scene 6.** If seconds must come from somewhere, trim Scene 1 to 5s and
  Scene 7 to 5s. The receipt is the one beat competitors can't copy.

---

## 8. 15-second cut (for social)

**Scene 1 (flatline, 3s)** → **Scene 3 (coin appears, 4s)** → **Scene 5 (vault opens
+ crossing, 5s)** → **Scene 6/7 mashup (receipt stamp + wordmark, 3s)**.
VO: "When your keys die with you, your crypto is gone. Obol makes it inheritable — a
zero-knowledge dead man's switch, live on Stellar. No custodian. No trace." End on the
`VERIFIED ON-CHAIN` stamp cutting to the coin.
