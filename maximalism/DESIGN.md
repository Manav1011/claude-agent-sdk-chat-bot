---
version: "alpha"
name: "De Stijl Abstrato"
description: "De Stijl abstract landing page. Ideal for landing pages, saas. AI-ready template."
colors:
  primary: "#FF0000"
  secondary: "#0000FF"
  tertiary: "#FFFF00"
  neutral: "#000000"
  surface: "#FFFFFF"
  accent: "#808080"
typography:
  h1:
    fontFamily: Helvetica
    fontSize: 2.5rem
    fontWeight: 700
  body-md:
    fontFamily: Helvetica
    fontSize: 1rem
    fontWeight: 400
spacing:
  sm: 10.0px
  md: 20.0px
  lg: 40.0px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral}"
    padding: 12px
---

## Overview

De Stijl abstract landing page. Ideal for landing pages, saas. AI-ready template. In 1917, a group of Dutch artists and architects decided that art had too much ego. Theo van Doesburg launched De Stijl magazine, and alongside Piet Mondrian, proposed something radical: reduce everything to horizontals, verticals, and the three primary colors plus black and white. That's it. No curves, no gradients, no compromise. They believed this vocabulary was universal — a visual Esperanto that needed no cultural translation.

Mondrian's compositions look deceptively simple. A black grid, rectangles of red, yellow, blue, white. But spend time with them and you notice the tension. The asymmetry is deliberate. Weight shifts. Proportions breathe. He was solving the same problem we solve today: how to create dynamic balance within a rigid structure.

The movement's DNA runs through everything we build now. CSS Grid is, at its core, a De Stijl machine. The 12-column layout, the modular spacing system, the idea that constraint breeds creativity — Mondrian figured that out a century before we wrote our first media query. Gerrit Rietveld's furniture and architecture proved the system worked in three dimensions. The Bauhaus absorbed it. Swiss typography refined it. And every time you align elements to a baseline grid, you're channeling Utrecht, 1917.

- Density: 3/10 — Airy
- Variance: 7/10 — Dynamic
- Motion: 4/10 — Subtle

- **Style:** Geometric, Minimalist, Structured
- **Keywords:** de stijl, abstract, geometric, minimalist, structured, primary colors, grid, bold lines, asymmetrical, neoplasticism
- **Era:** Early 20th Century, Neoplasticism
- **Light/Dark:** ✓ Full / ✗ No

## Colors

- **Primary Red** (#FF0000) — Primary accent, CTAs and interactive elements
- **Primary Blue** (#0000FF) — Primary accent, CTAs and interactive elements
- **Primary Yellow** (#FFFF00) — Primary accent, CTAs and interactive elements
- **Black** (#000000) — Dark surface, primary background
- **White** (#FFFFFF) — Secondary surface
- **Grey** (#808080) — Secondary text, borders, muted elements


## Typography

- **Display / Hero:** Helvetica — Weight 700, tight tracking, used for headline impact
- **Body:** Helvetica — Weight 400, 16px/1.6 line-height, max 72ch per line
- **UI Labels / Captions:** Helvetica — 0.875rem, weight 500, slight letter-spacing
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

Strong grid layout, bold black lines, blocks of primary colors, asymmetrical balance, minimalist typography, focus on composition, no decorative elements, sharp corners

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
- No decorative gradients — flat color only
- No shadows heavier than 0 2px 8px rgba(0,0,0,0.08)
- No pure black (#000000) — use off-black or charcoal variants
- No oversaturated accent colors (saturation cap: 80%)
- No 3-column equal-width feature layouts — use zig-zag or asymmetric grid
- No `h-screen` — use `min-h-[100dvh]`
- No AI copywriting clichés: "Elevate", "Seamless", "Unleash", "Next-Gen"
- No broken external image links — use picsum.photos or inline SVG
- No generic lorem ipsum in demos

- Do Strong grid layout
- Do Bold black lines
- Do Blocks of primary colors
- Do Asymmetrical balance
- Do Minimalist typography
- Do Sharp corners


## Use Case

Landing pages, SaaS
