# Lexi's Studio

A private, installable fitness tracker: weight and the 7-day average, waist tape, steps, plates with
estimated calories, a weekly treat meter, the Gym A / Gym B card as a live checklist, rower and
treadmill and adventure entries, trends, badges and levels — with Lexi's lines on the home screen.

**This repository holds code only.** Entries are written to a *private* GitHub repository of the
owner's choosing through the GitHub Contents API, using a fine-grained token that lives only in the
browser that typed it. Nothing personal is ever committed here, and the site carries `noindex`.

Static files, no build step. Open `index.html` from any static host (GitHub Pages works). The service
worker keeps the app usable offline; entries queue and sync when a connection returns.

Calorie figures in `foods.json` are USDA FoodData Central values for a stated serving (FDC IDs in each
item's `source`); they are estimates for a normal portion, not measurements.
