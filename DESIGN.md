---
name: Remindly
description: A warm, personal event reminder app that feels like a well-loved paper planner
colors:
  sage: "#6a9e7e"
  sage-deep: "#548466"
  terracotta: "#c4735a"
  cream: "#faf8f4"
  paper: "#f2efe8"
  ink: "#2d2926"
  ink-muted: "#7a7470"
  border: "#e0dbd4"
  border-light: "#ebe7e0"
typography:
  display:
    fontFamily: "Nunito, 'Segoe UI', system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Nunito, 'Segoe UI', system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Nunito, 'Segoe UI', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Nunito, 'Segoe UI', system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.01em"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  xxl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.sage}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.sage-deep}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  button-danger:
    backgroundColor: "{colors.terracotta}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  input:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
  card:
    backgroundColor: "#ffffff"
    rounded: "{rounded.lg}"
    padding: "20px"
  badge:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.sage-deep}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
---

# Design System: Remindly

## 1. Overview

**Creative North Star: "The Cozy Planner"**

Remindly's visual identity draws from the warmth and familiarity of a well-loved paper planner, the kind you keep on your desk year after year, filled with handwritten birthdays, holidays, and anniversaries. The interface feels like opening that planner on a quiet Sunday morning: cream-colored pages, soft sage accents marking important dates, and a sense of calm organization.

This is a personal tool, not a corporate dashboard. Every design choice reinforces approachability over efficiency-at-all-costs. Rounded shapes feel friendly rather than clinical. The warm cream background evokes paper rather than screen. Typography is soft and readable, never austere. The sage green accent appears where it matters most: navigation, primary actions, and key headings, but never overwhelms the content.

This system explicitly rejects the sterile gray-blue aesthetic of enterprise SaaS tools. No cold whites, no sharp corners, no aggressive information density. It also avoids the overly playful or cartoonish: this is a mature, trustworthy companion for personal organization.

**Key Characteristics:**
- Warm cream surfaces that feel like paper, not screens
- Soft sage green as the primary accent, used with intention
- Rounded, friendly typography (Nunito) at every scale
- Generous whitespace that lets content breathe
- Subtle depth through warm-toned shadows, never harsh

## 2. Colors

The palette is built around soft sage green and warm neutrals, evoking natural materials and quiet mornings.

### Primary
- **Soft Sage** (#6a9e7e / oklch(0.62 0.09 148)): The brand's signature color. Used for primary buttons, active navigation links, section headings, and key interactive elements. Its muted green tone feels natural and calming, never corporate.
- **Deep Sage** (#548466 / oklch(0.54 0.09 148)): Hover and active states for primary elements. Provides clear feedback without jarring contrast.

### Secondary
- **Warm Terracotta** (#c4735a / oklch(0.60 0.12 45)): Used sparingly for destructive actions (delete buttons) and warm accent badges. Complements the sage without competing. Earthy and grounded.

### Neutral
- **Cream** (#faf8f4 / oklch(0.975 0.012 80)): The primary background. Warm enough to feel like paper, light enough to stay airy. This is the canvas everything sits on.
- **Paper** (#f2efe8 / oklch(0.94 0.015 80)): Secondary surface for cards, panels, and recessed areas. Slightly deeper than cream, providing gentle separation without borders.
- **Ink** (#2d2926 / oklch(0.22 0.015 55)): Body text and primary content. A deep warm brown-black, softer than pure black. Reads clearly against cream while maintaining the warm palette.
- **Muted Ink** (#7a7470 / oklch(0.52 0.015 55)): Secondary text, timestamps, helper text. Warm gray that recedes without disappearing.
- **Border** (#e0dbd4 / oklch(0.89 0.012 80)): Default borders and dividers. Warm and subtle, never gray.
- **Border Light** (#ebe7e0 / oklch(0.92 0.010 80)): Hairline borders and table dividers. Barely visible, providing structure without visual noise.

### Named Rules

**The Sage Restraint Rule.** Sage green appears on no more than 20% of any given screen. Its warmth is the accent, not the atmosphere. When in doubt, use cream or paper instead.

**The Paper Stack Rule.** Depth is conveyed through cream-to-paper tonal shifts, not heavy shadows. A card on cream reads as a sheet of paper lifted slightly off the desk.

## 3. Typography

**Display Font:** Nunito (with 'Segoe UI', system-ui, sans-serif fallback)
**Body Font:** Nunito (with 'Segoe UI', system-ui, sans-serif fallback)

**Character:** Nunito's rounded terminals and generous proportions give every word a friendly, approachable quality. It reads clearly at small sizes while retaining personality at display scale. Using a single family across all weights keeps the system cohesive and lightweight.

### Hierarchy
- **Display** (700, 1.75rem / 28px, line-height 1.2): Page titles and main headings. Bold enough to anchor the page, but never shouting. Letter-spacing: -0.01em for slight tightness at large sizes.
- **Headline** (700, 1.25rem / 20px, line-height 1.3): Section headings, card titles, table headers. Clear hierarchy without excessive scale jump.
- **Body** (400, 1rem / 16px, line-height 1.6): Default text, descriptions, form labels. Comfortable reading rhythm with generous line-height. Max line length: 65ch.
- **Label** (600, 0.8125rem / 13px, line-height 1.4): Form labels, badges, small UI text. Slightly heavier weight ensures legibility at small sizes. Letter-spacing: 0.01em.

### Named Rules

**The Single Voice Rule.** One typeface (Nunito) carries the entire interface. Weight contrast (400/600/700) provides hierarchy, not font switching. This keeps the system feeling unified, like handwriting from one person.

## 4. Elevation

This system uses warm-toned, barely-there shadows to suggest gentle layering, like pages in a planner stacked on a desk. Shadows are never harsh or cool-toned. Depth is primarily conveyed through the cream-to-paper tonal shift, with shadows as a subtle reinforcement.

### Shadow Vocabulary
- **Resting** (`0 1px 3px rgba(45, 41, 38, 0.06), 0 1px 2px rgba(45, 41, 38, 0.04)`): Cards, panels, and containers at rest. Barely perceptible, providing just enough lift to separate from the cream background.
- **Interactive** (`0 4px 12px rgba(45, 41, 38, 0.08), 0 2px 4px rgba(45, 41, 38, 0.04)`): Hover states and elevated elements. Noticeable but not dramatic.
- **Overlay** (`0 8px 24px rgba(45, 41, 38, 0.12), 0 4px 8px rgba(45, 41, 38, 0.06)`): Modals, dropdowns, and floating elements. The strongest shadow, still warm and diffused.

### Named Rules

**The Paper Shadow Rule.** All shadows use the ink color (warm brown) at low opacity, never pure black or cool gray. Shadows should feel like natural light falling on paper, not digital drop-shadows.

## 5. Components

### Buttons
- **Shape:** Gently rounded corners (10px radius), approachable but not pill-shaped
- **Primary:** Soft Sage background (#6a9e7e) with white text. Padding: 10px 20px. Font weight 600.
- **Hover / Focus:** Transitions to Deep Sage (#548466) over 150ms. Focus ring: 2px solid Sage at 2px offset.
- **Secondary:** Paper background (#f2efe8) with Ink text. Same padding. Hover darkens to Border (#e0dbd4).
- **Danger:** Warm Terracotta (#c4735a) with white text. Smaller padding (8px 16px) to signal caution.
- **Small variant:** Reduced padding (6px 12px), font-size 0.8125rem.

### Badges / Chips
- **Style:** Pill-shaped (999px radius), Paper background with Deep Sage text
- **Variants:** Category badges use Paper + Deep Sage. Recurring badges use a light sage tint. One-time badges use a light terracotta tint.
- **Size:** 3px 10px padding, label font size.

### Cards / Containers
- **Corner Style:** Generously rounded (14px radius), soft and inviting
- **Background:** White (#ffffff) on Cream background, or Paper on White for nested surfaces
- **Shadow Strategy:** Resting shadow at default, Interactive shadow on hover
- **Border:** None by default; tonal separation via background contrast. Optional Border Light (#ebe7e0) for table rows and dividers.
- **Internal Padding:** 20px standard, 16px for compact cards.

### Inputs / Fields
- **Style:** White background, 1px Border (#e0dbd4) stroke, 10px radius. Padding: 10px 14px.
- **Focus:** Border transitions to Sage (#6a9e7e), subtle sage glow (0 0 0 3px rgba(106, 158, 126, 0.15)).
- **Error:** Border transitions to Terracotta (#c4735a), light terracotta glow.
- **Labels:** Label weight (600), Ink color, 6px margin below input.

### Navigation
- **Style:** Text links in Sage color, no background. Font weight 600 for active, 400 for inactive.
- **Hover:** Underline appears, color deepens to Deep Sage.
- **Active:** Sage color with subtle bottom border (2px solid Sage).
- **Header:** White background with Resting shadow, generous padding (20px). Logo/brand name in Display weight, Sage color.

### Tables
- **Style:** Clean, borderless rows with Border Light dividers. No heavy grid lines.
- **Header:** Paper background, Label font weight, slightly smaller text.
- **Rows:** 12px vertical padding, hover highlights row with faint Paper tint.
- **Actions:** Small buttons aligned right, secondary and danger variants.

### Empty States
- **Style:** Centered text, Muted Ink color, generous padding (48px).
- **Character:** Friendly, encouraging message. Never clinical "No data found."

## 6. Do's and Don'ts

### Do:
- **Do** use Cream (#faf8f4) as the primary background, never pure white (#ffffff). The warmth is essential to the cozy planner feel.
- **Do** use Nunito at every scale. Weight contrast (400/600/700) provides all the hierarchy needed.
- **Do** keep sage green to 20% or less of any screen. Let cream and paper do the heavy lifting.
- **Do** use warm-toned shadows (rgba with ink's warm brown hue), never cool gray or pure black shadows.
- **Do** use generous border-radius (10-14px) on cards and containers. The softness is intentional.
- **Do** write friendly, encouraging copy in empty states and error messages. "No events yet. Create your first one!" not "No data found."

### Don't:
- **Don't** use corporate SaaS patterns: gray-blue palettes, sharp corners, dense information layouts, or clinical copy. This is a personal tool, not an enterprise dashboard.
- **Don't** use pure white (#ffffff) backgrounds or pure black (#000000) text. The warm palette requires cream and ink, not stark contrasts.
- **Don't** use glassmorphism, gradient text, or decorative blurs. The aesthetic is paper and ink, not glass and light.
- **Don't** add side-stripe borders (border-left > 1px as colored accents) on cards or list items. Use full borders, background tints, or no borders at all.
- **Don't** use more than one typeface. The Single Voice Rule keeps the system cohesive.
- **Don't** make shadows harsh or cool-toned. If the shadow looks like a 2014 Material Design card, it's too dark and too gray.
- **Don't** use overly playful or cartoon-like elements. The warmth comes from color and typography, not illustrations or decorative elements.
- **Don't** use dark mode or heavy dark themes. This system is designed for light, airy interfaces that feel like paper.
