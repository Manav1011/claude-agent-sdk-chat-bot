---
version: "alpha"
name: "8-Bit Retro Terminal"
description: "8-bit landing page, retro terminal style, pixel art, green phosphor text, scanlines, arcade game aesthetic. Ideal for landing pages, modern websites. AI-ready template."
colors:
  primary: "#050505"
  secondary: "#2CFF56"
  tertiary: "#FFB200"
  neutral: "#FFFFFF"
  surface: "#FFD700"
  accent: "#FF0000"
typography:
  h1:
    fontFamily: Press Start 2P
    fontSize: 2.5rem
    fontWeight: 700
  body-md:
    fontFamily: Press Start 2P
    fontSize: 1rem
    fontWeight: 400
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral}"
    padding: 12px
---

## Overview

8-bit landing page, retro terminal style, pixel art, green phosphor text, scanlines, arcade game aesthetic. Ideal for landing pages, modern websites. AI-ready template. Before screens could render curves, before anti-aliasing existed as a concept, every character lived on a grid. The Commodore 64 gave you 40 columns and 25 rows. DOS handed you green phosphor on black. The early Macintosh — despite its GUI ambitions — still rendered Chicago in bitmaps, every letter a tiny sculpture of on/off pixels.

These weren't aesthetic choices. They were physics. CRT electron guns, limited VRAM, 8-bit address buses that could only think in powers of two. Designers worked within brutal constraints: monospaced type because proportional spacing cost too many cycles, blocky cursors because sub-pixel rendering was decades away, scan lines because that's literally how the beam drew.

Then something happened. The constraints disappeared but the look didn't. Somewhere in the late 2000s, indie developers and digital artists started reaching back — not out of laziness, but recognition. Those limitations had produced something genuinely beautiful. The grid wasn't a cage. It was a composition tool. The low resolution forced clarity. Every pixel earned its place.

- Density: 8/10 — Dense
- Variance: 7/10 — Dynamic
- Motion: 4/10 — Subtle

- **Style:** Technical, Nostalgic, Cryptic
- **Keywords:** 8-bit, retro, pixel, terminal, green, arcade, game, console
- **Era:** 80s Computing
- **Light/Dark:** ✗ No / ✓ Full

## Colors

- **Background** (#050505) — Primary background surface
- **Text** (#2CFF56) — Primary text color
- **Accent** (#FFB200) — Primary accent, CTAs and interactive elements
- **Pixel White** (#FFFFFF) — Secondary surface
- **Coin Yellow** (#FFD700) — Warning states, attention indicators
- **Heart Red** (#FF0000) — Error states, destructive actions


## Typography

- **Display / Hero:** Press Start 2P — Weight 700, tight tracking, used for headline impact
- **Body:** Press Start 2P — Weight 400, 16px/1.6 line-height, max 72ch per line
- **UI Labels / Captions:** Press Start 2P — 0.875rem, weight 500, slight letter-spacing
- **Monospace:** JetBrains Mono — Used for code, metadata, and technical values

Scale:
- Hero: clamp(2.5rem, 5vw, 4rem)
- H1: 2.25rem
- H2: 1.5rem
- Body: 1rem / 1.6
- Small: 0.875rem


## Layout

- **Grid:** CSS Grid primary. Max-width containment: 1280px centered with 1.5rem side padding.
- **Spacing rhythm:** Balanced. Base unit: 0.5rem (8px).
- **Section vertical gaps:** clamp(4rem, 8vw, 8rem).
- **Hero layout:** Asymmetric composition.
- **Feature sections:** Asymmetric grid with varied card sizes. No 3-equal-columns.
- **Mobile collapse:** All multi-column layouts collapse below 768px. No horizontal overflow.
- **z-index contract:** base (0) / sticky-nav (100) / overlay (200) / modal (300) / toast (500).


## Elevation & Depth

ASCII art, pixel-art iconography, binary strings, bracket-style terminal frames, CRT monitor phosphor glow, scanlines.

- **Physics:** Ease-out curves, 200-300ms duration. Smooth and predictable.
- **Entry animations:** Fade + translate-Y (16px → 0) over 420ms ease-out. Staggered cascades for lists: 80ms between items.
- **Hover states:** Subtle color shift + shadow adjustment over 200ms.
- **Page transitions:** Fade only (200ms).
- **Performance:** Only transform and opacity animated. No layout-triggering properties.


## Shapes

Base corner radius: 8px. See rounded tokens in front matter for the full scale.


## Components

- **Primary Button:** Subtly rounded (0.5rem) shape. Accent color fill. Hover: 8% darken + subtle lift shadow. Active: -1px translate tactile press. Font weight 600. No outer glows.
- **Secondary / Ghost Button:** Outline variant. 1.5px border in muted color. Text in primary color. Hover: subtle background fill.
- **Cards:** Subtly rounded (0.5rem) corners. Surface background. Subtle shadow (0 2px 12px rgba(0,0,0,0.06)). 1px border stroke.
- **Inputs:** Label above input. 1px border stroke. Focus ring: 2px accent color offset 2px. Error text below in semantic red. No floating labels.
- **Navigation:** Primary surface background. Active item: accent color indicator. Font weight 500 when active.
- **Skeletons:** Shimmer animation matching component dimensions. No circular spinners.
- **Empty States:** Icon-based composition with descriptive text and action button.


## Do's and Don'ts

- No emojis in UI — use icon system only (Lucide, Heroicons)
- No pure black (#000000) — use off-black or charcoal variants
- No oversaturated accent colors (saturation cap: 80%)
- No 3-column equal-width feature layouts — use zig-zag or asymmetric grid
- No `h-screen` — use `min-h-[100dvh]`
- No AI copywriting clichés: "Elevate", "Seamless", "Unleash", "Next-Gen"
- No broken external image links — use picsum.photos or inline SVG
- No generic lorem ipsum in demos

- Do Pixel art fonts/icons
- Do High contrast black/green/yellow
- Do Blocky layout elements
- Do CRT scanline overlay (optional)
- Do Arcade game references


## Use Case

Landing pages, Modern websites
