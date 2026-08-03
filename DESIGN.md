---
name: Gitty
description: A quiet, exact working instrument for understanding and changing a Git repository.
colors:
  daylight-canvas: "#f4f6f9"
  daylight-panel: "#ffffff"
  daylight-sidebar: "#eef1f6"
  daylight-ink: "#111827"
  daylight-secondary: "#4b5563"
  daylight-line: "#dde3ec"
  night-canvas: "#0c0f14"
  night-panel: "#12161e"
  night-elevated: "#171c26"
  night-ink: "#eef2f7"
  instrument-blue: "#2563eb"
  instrument-blue-night: "#4d9eff"
  working-green: "#10b981"
  attention-amber: "#f59e0b"
  stop-red: "#ef4444"
typography:
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: 19px
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.25
  timeline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.2
  caption:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: 10px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: 0.06em
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Cascadia Mono, Menlo, Consolas, monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.45
rounded:
  control: 7px
  surface: 10px
  pill: 999px
spacing:
  hairline: 2px
  xs: 4px
  compact: 6px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 48px
components:
  button-working:
    backgroundColor: "{colors.working-green}"
    textColor: "{colors.daylight-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 {spacing.md}"
    height: 40px
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.daylight-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: 32px
  tag-reference:
    backgroundColor: "{colors.daylight-sidebar}"
    textColor: "{colors.instrument-blue}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "2px 7px"
  input-default:
    backgroundColor: "{colors.daylight-panel}"
    textColor: "{colors.daylight-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "7px 10px"
    height: 34px
  timeline-node:
    backgroundColor: "{colors.daylight-panel}"
    textColor: "{colors.daylight-ink}"
    typography: "{typography.timeline}"
    rounded: "{rounded.control}"
    padding: "6px 8px"
    width: 148px
    height: 60px
---

# Design System: Gitty

## 1. Overview

**Creative North Star: "The Working Instrument"**

Gitty should feel like a trusted instrument on a developer's desk: quiet at rest, exact under pressure, and satisfying to operate repeatedly. Imagine it moving from a bright daytime office to a dim late-night monitor while its maker builds Gitty inside Gitty. The interface follows the environment, preserves spatial memory, and keeps the repository itself louder than the chrome.

This is a compact, tactile system built from type, measured spacing, structural borders, and restrained signal color. It rejects lane forests, ornamental dashboards, decorative color, glass effects, and platform mimicry. Information density is welcome when hierarchy remains immediate.

**Key Characteristics:**

- Quiet, exact, and self-hosting.
- Compact controls with generous interaction targets.
- Structural layering instead of ornamental effects.
- Signal colors reserved for branch identity, availability, and state.
- One continuous timeline with a denser branch graph on demand.

**Share Artwork:** Link previews use the exact shipping app icon centered on a quiet Night Canvas field with restrained icon-derived light. Do not redraw the mark or embed titles and taglines in the bitmap; metadata carries the copy.

## 2. Colors

The palette is neutral and low-noise, with one blue instrument signal and semantic colors that always carry meaning.

### Primary

- **Instrument Blue** (`#2563eb`, night `#4d9eff`): selection focus, branch identity, links, and pull availability.
- **Working Green** (`#10b981`): commit, push, return, and verified success states.

### Secondary

- **Attention Amber** (`#f59e0b`): warnings and actions that deserve review without implying failure.
- **Stop Red** (`#ef4444`): destructive actions, errors, and deleted diff content only.

### Neutral

- **Daylight Canvas** (`#f4f6f9`) and **Daylight Panel** (`#ffffff`): page depth and working surfaces.
- **Daylight Sidebar** (`#eef1f6`) and **Daylight Line** (`#dde3ec`): grouping, hover fields, and dividers.
- **Daylight Ink** (`#111827`) and **Daylight Secondary** (`#4b5563`): primary and supporting information.
- **Night Canvas** (`#0c0f14`), **Night Panel** (`#12161e`), and **Night Elevated** (`#171c26`): dark-mode depth without pure black.
- **Night Ink** (`#eef2f7`): primary dark-mode text.

**The Color Has a Job Rule.** Fill answers "do I have this," weight answers "is this my line," color answers "which branch" or "what state," and shape or decoration distinguishes state within a single timeline.

## 3. Typography

**Display Font:** Inter with the system sans-serif fallback stack

**Body Font:** Inter with the system sans-serif fallback stack

**Label/Mono Font:** System monospace for hashes, paths, diffs, and machine identifiers

**Character:** Calm, compact, and highly legible. Human meaning uses proportional type; machine identity uses monospace and remains secondary until requested.

### Hierarchy

- **Headline** (600, 19px, 1.25): panel headings and rare high-level moments.
- **Title** (600, 16px, 1.25): inspector subjects, dialogs, and focused content.
- **Body** (400, 14px, 1.45): prose, controls, and primary row content.
- **Label** (600, 12px, 1.25): metadata, compact navigation, and status.
- **Timeline Preview** (400, 12px, 1.2): quiet, human-readable commit subjects.
- **Caption** (500, 10px, 0.06em tracking): timestamps and tertiary annotations.
- **Mono** (400, 12px, 1.45): hashes, file paths, diffs, and command output.

**The Meaning Before Identity Rule.** Show the commit subject before the hash in both Timeline and Branches. A hash is metadata, not a human-scannable title.

## 4. Elevation

Gitty is flat by default and uses tonal layering plus one-pixel borders for structure. The low shadow (`0 1px 3px rgba(0,0,0,0.06)`, dark `0 1px 3px rgba(0,0,0,0.35)`) may clarify a raised active control. Floating menus and dialogs add `0 8px 24px rgba(0,0,0,0.12)` so they detach from dense repository content.

### Shadow Vocabulary

- **Low Lift** (`0 1px 3px rgba(0,0,0,0.06)`): active segmented controls and small raised surfaces.
- **Overlay Lift** (`0 8px 24px rgba(0,0,0,0.12)`): context menus, popovers, and dialogs only.

**The Flat Until Floating Rule.** Surfaces remain flat at rest. Shadows appear only when a control rises or content floats above another interaction plane.

## 5. Components

### Buttons

- **Shape:** compact 7px corners, 32px secondary height, and 36px to 40px for consequential actions.
- **Primary:** Working Green with dark ink for commit and push. Instrument Blue remains a tonal availability cue for pull and selection.
- **Hover / Focus:** use a 120ms to 150ms ease and a 2px Instrument Blue outline with 2px offset. Active press may scale to 0.98.
- **Ghost:** transparent with a one-pixel border and secondary text; neutral hover fill only.

### Chips

- **Style:** 999px pills, 10px to 12px labels, and 2px 7px padding.
- **State:** reference tags use soft Instrument Blue. Unpushed tags use a dashed border. Inert context chips flatten; interactive chips keep a border.

### Cards / Containers

- **Corner Style:** 10px for surfaces and 7px for controls.
- **Background:** panel against canvas, with sidebar tone for secondary regions.
- **Shadow Strategy:** follow the Flat Until Floating Rule.
- **Border:** one pixel, low contrast, structural rather than decorative.
- **Internal Padding:** 12px compact, 16px standard, 24px spacious.

### Inputs / Fields

- **Style:** panel background, one-pixel border, 7px corners, 34px minimum height, and 7px 10px padding.
- **Focus:** 2px Instrument Blue outline with 2px offset.
- **Error / Disabled:** Stop Red is reserved for a verified error; disabled controls reduce contrast without hiding their label.

### Navigation

The view switch is a compact pill with a tonal canvas and a raised active segment. Timeline remains the default; Branches is a dense view on demand. Changing selection inside Branches must not switch the user back to Timeline.

### Timeline, Tags, and Commit Inspector

The timeline is the signature component: a horizontal, always-visible strip whose 148px by 60px nodes lead with a two-line message preview, then supporting time or identity. A subject-only message wraps across both lines; a message with a body uses one line for the subject and one for the first meaningful body line. One fixed cursor baseline runs beneath commit nodes and the pinned Now chrome so selection never changes vertical position. Tagged commits gain a small outer-ring marker and show the first tag plus `+N`; tags outrank timestamps when space is constrained. The inspector shows the full subject, body, hash, refs, and tag management. Both Timeline and Branches use the same selection model, context actions, and inspector. A separate searchable Tags popover beside the view switch reveals all repository tags, including tags outside the loaded commit window.

## 6. Do's and Don'ts

### Do:

- **Do** preserve Timeline as the default and Branches as a dense view on demand.
- **Do** lead every commit representation with its subject and keep the hash available as secondary monospace metadata.
- **Do** expose tag creation, deletion, copying, and inspection from both views and the shared inspector.
- **Do** keep unknown state explicit and verify repository state before asserting it.
- **Do** honor system light, dark, and reduced-motion preferences across platforms.

### Don't:

- **Don't** introduce lane forests into the horizontal timeline.
- **Don't** expose raw Git error text without translating it into a clear next action.
- **Don't** use decorative color; every accent must identify a branch, availability, or state.
- **Don't** let the interface assert unverified state.
- **Don't** rely on Apple-specific styling or behavior for core polish.
- **Don't** use glassmorphism, gradients, colored side stripes, nested cards, or shadows on resting surfaces.
