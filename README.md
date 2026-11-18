# F1 Portal

Educational multi-page website about Formula 1 (Astana IT University, Web course).
Authors: Anuar Tursynbekov, Zhanaiym Sadyk.

## Pages (11)
`index` · `teams` · `drivers` · `races` · `gallery` · `about` · `contact` · `signup` · `login` · `profile` · `404`

## Features
- Responsive layout: Bootstrap 5 grid + CSS Grid page layout + Flexbox cards (3/2/1 columns by media queries)
- Light / dark mode switch, saved in `localStorage`, high-contrast palette (axe-core: 0 WCAG A/AA violations)
- Sign Up / Log In / Profile simulated with `localStorage` (passwords stored as salted SHA-256, never plain text)
- JavaScript-only form validation (email, phone, password strength, required fields) with inline error messages; no HTML validation attributes, forms use `novalidate`
- Live data from the public Jolpica F1 API (`fetch`): next race, race calendar, last result, driver and constructor standings, with loading state and error handling + Retry
- Search with autocomplete and highlighting, recent searches, gallery and race filters (saved in `localStorage`), favourite drivers
- Animated buttons, carousel (9 photos), lightbox, toasts, English / Russian / Kazakh interface

## Structure
```
index.html, teams.html, ... 404.html
css/style.css
js/script.js  (core UI)   js/auth.js (accounts)   js/api.js (API)   js/i18n.js (translations)
images/  data/facts.json
```

## Run locally
Open `index.html`, or serve the folder: `python3 -m http.server 8000` and visit http://localhost:8000.

## Publish on GitHub Pages
1. Create a repository on GitHub and upload all files from this folder (the `index.html` must be in the repository root).
2. Repository → Settings → Pages → Source: `Deploy from a branch`, Branch: `main` / `(root)` → Save.
3. After about a minute the site is available at `https://<username>.github.io/<repository>/`.
4. Put the repository link and the live link into `ProjectName_GroupName_Links.txt`.

## Credits
Race data: Jolpica F1 API (https://api.jolpi.ca). Bootstrap 5.3.3, jQuery 3.7.1.
