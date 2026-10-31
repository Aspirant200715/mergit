/*
 * Mounts the scroll story: builds the illustrations, one master timeline in
 * seconds, and scrubs it with page scroll. The stage is a fixed 1920x1080
 * artboard scaled to fit the viewport; the background is scaled to cover it.
 */
import gsap from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { beatsIntro } from "./beatsIntro";
import { beatsMid } from "./beatsMid";
import { beatsTail } from "./beatsTail";
import { storyCopy } from "./copy";
import { heroArt } from "./heroArt";
import { playHeroIntro } from "./heroIntro";
import { helpers } from "./motion";
import { buildScenes } from "./scenes";

gsap.registerPlugin(ScrollTrigger, MotionPathPlugin);

/** Timeline length in seconds, and how many pixels of scroll one second takes. */
export const STORY_T = 102;
export const SCROLL_PX = 520;
/** The scroll story starts just before the hero leaves; the hero itself plays on load. */
export const STORY_START = 5.6;

/** Section starts (seconds) that the nav links jump to. */
export const ANCHORS = [
  ["how-it-works", 18.6],
  ["agents", 31],
  ["proofs", 59.2],
  ["integrations", 84.9],
] as const;

const SECTIONS = [0, 6.8, 16, 26.8, 54.8, 82, 90, 96.8];

/** Resting points: every scene and every stepper step. Scrolling settles on the next one. */
const STOPS = [
  5.6, // hero
  11.9, // problem: the metered side is done
  14.2, // problem: both sides done
  18.6, // how it works: the stack has opened
  23.9, // how it works: all four steps labelled
  31, // team 1: the planner lifts
  37.9, // team 2: work dispatched
  42.8, // team 3: approval granted
  48.2, // team 4: hashes merged into one proof
  52.8, // team 5: identities issued
  59.2, // settlement 1: funded and held
  64.4, // settlement 2: receipt built
  69.6, // settlement 3: receipt checked
  74.9, // settlement 4: agent paid
  81, // settlement 5: refunded
  84.9, // integrations: wired
  88.7, // integrations: the loop closed
  92.6, // credentials: boundary in place
  96, // credentials: key blocked
  100.5, // closer
  STORY_T,
];

export function mountStory(root: HTMLElement, artSvg: SVGSVGElement) {
  const pin = root.querySelector<HTMLElement>(".story-pin");
  if (!pin) return undefined;

  // The floating nav takes the top band; the artboard fits the space under it.
  const NAV = 84;
  const fit = () => {
    const w = pin.clientWidth;
    const h = pin.clientHeight;
    pin.style.setProperty("--k", String(Math.min(w / 1920, (h - NAV) / 1080)));
    pin.style.setProperty("--kb", String(Math.max(w / 1920, h / 1080)));
    pin.style.setProperty("--top", `${String(NAV + (h - NAV) / 2)}px`);
  };
  fit();
  window.addEventListener("resize", fit);

  let stopIntro: (() => void) | undefined;
  const ctx = gsap.context(() => {
    const S = buildScenes(root);
    const tl = gsap.timeline({ defaults: { ease: "power3.out", lazy: false }, paused: true });
    const h = helpers(tl, root);
    tl.fromTo(h.q("#prog i"), { scaleX: 0 }, { scaleX: 1, ease: "none", duration: STORY_T, immediateRender: false }, 0);
    beatsIntro(h, tl, S, STORY_T);
    const syncMid = beatsMid(h, tl, S);
    beatsTail(h, tl, S);
    tl.set({}, {}, STORY_T);

    const idxN = h.q("#idx-n");
    const idxT = h.q("#idx-t");
    let last = -1;
    tl.eventCallback("onUpdate", () => {
      const t = tl.time();
      let i = 0;
      SECTIONS.forEach((s, k) => {
        if (t >= s) i = k;
      });
      if (i !== last) {
        last = i;
        idxN.textContent = `0${String(i + 1)}`;
        idxT.textContent = storyCopy.index[i] ?? "";
      }
      h.syncScenes(t);
      syncMid(t);
    });

    const span = STORY_T - STORY_START;
    // Render everything up to the start so later scenes sit in their resting state.
    tl.time(STORY_START);
    h.syncScenes(STORY_START);
    syncMid(STORY_START);
    const scrub = tl.tweenFromTo(STORY_START, STORY_T, { paused: true, ease: "none" });
    ScrollTrigger.create({
      trigger: root,
      start: "top top",
      end: "bottom bottom",
      scrub: 2,
      animation: scrub,
      snap: {
        snapTo: STOPS.map((s) => (s - STORY_START) / span),
        directional: true,
        inertia: false,
        delay: 0.15,
        duration: { min: 1, max: 3.4 },
        ease: "power2.inOut",
      },
    });
    stopIntro = playHeroIntro(root, heroArt(artSvg));
  }, root);

  return () => {
    window.removeEventListener("resize", fit);
    stopIntro?.();
    ctx.revert();
    artSvg.replaceChildren();
    // The illustrations are built imperatively; clear them so a remount starts clean.
    root.querySelectorAll(".iso-svg, #h-links, #leaders, #pulses").forEach((n) => {
      n.replaceChildren();
    });
  };
}
