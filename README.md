# PIANO DUO HW

Personal planning and research app for Piano Duo Hua & Wei (华&薇).
Live at https://jessie0029.github.io/piano-duo-hw/ — installable on Android (Chrome → ⋮ → Add to Home screen) and works offline.

- **Plan** – month/week calendar of post ideas (tags, platforms, reel/carousel, EN/DE captions, approval) and occasions (preloaded composer anniversaries + your own dates)
- **Reminders** – what the duo owes you, plus posts coming up; notifications one day before a post
- **News** – Google News for piano-duo keywords in English and German, refreshed every 6 hours (`.github/workflows/news.yml`)
- **Concerts** – which European venues, promoters, festivals and orchestras have booked piano duos since 2005, with Excel export. Built from `research/` (see `research/README.md`); a Claude scheduled task adds new research every 2 days.
- **Caption Studio** – https://claude.ai/artifact/LyXJc8AKpJzQvyHURjBTh5 (polish English → German → native German)

Data syncs through Firebase (project `piano-duo-hw`) with email-link sign-in.
Background notifications are sent by `.github/workflows/reminders.yml` and need the repository secret `FIREBASE_SERVICE_ACCOUNT` plus the `VAPID_KEY` in `js/config.js`.
