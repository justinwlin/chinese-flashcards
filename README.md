# Chinese Flashcards

A personal Anki-style flashcard app for learning to read and write Mandarin. It is a static site: reviews run in the browser, work offline after the first visit, and can be installed on an iPhone home screen.

The live app is [https://justinwlin.github.io/chinese-flashcards/](https://justinwlin.github.io/chinese-flashcards/).

Justin can already speak a little. The deck is aimed at pinyin and characters. Each word has two faces:

- **Read** shows the hanzi. The answer is colored pinyin plus the English meaning.
- **Write** shows the English. The answer is the hanzi and pinyin.

Pinyin is colored by tone: red for first, orange for second, green for third, blue for fourth, and gray for neutral. The speaker button uses the browser's Mandarin voice (`zh-CN`).

## Install on an iPhone

Use Safari. Chrome on iOS cannot add this kind of home-screen app.

1. Open [https://justinwlin.github.io/chinese-flashcards/](https://justinwlin.github.io/chinese-flashcards/) in Safari.
2. Tap the Share button (the square with the arrow).
3. Scroll the share sheet and tap **Add to Home Screen**. If it is missing, scroll to the bottom of the sheet and tap **Edit Actions**, then add it.
4. Name it **中文卡** and tap **Add**.
5. Open **中文卡** from the home screen, not from a bookmark, while you are online. That first launch stores the app and the word list for offline use.

The header shows the installed build, for example `v1.1.0 · 3823230 · built Oct 31, 3:45 AM`. The time is the deploy time in your phone's timezone. The same line is at the bottom of Settings. When a newer deploy is ready, a banner says **Update available, tap to reload**.

After that, today's reviews work without a connection, including from the installed icon. Progress is saved on the phone as soon as you grade a card.

## Daily review

The Today screen shows how many cards are learning, due, or new. New cards are capped (10 faces a day by default) so the deck does not dump every word on the first open. Change that, or study only Read or only Write, in Settings.

Grades follow an SM-2-style schedule with short learning steps:

| Button | Meaning | Typical first interval |
| --- | --- | --- |
| Again | Forgot it | 1 minute |
| Hard | Recalled with effort | 6 minutes for a new card |
| Good | Recalled | 10 minutes, then the next day |
| Easy | Too easy | 4 days |

Once a card has graduated, Good multiplies the interval by the card's ease (starting at 2.5). Again sends it back for a 10-minute relearning step and keeps about 20% of the old interval, so one miss does not erase a mature card. The number on each button is the interval that press will save.

## Sync across devices

Sync is optional. With no token, the app is complete: add words, review, and export a backup.

With a token, the app writes through the GitHub Contents API:

- New and edited words go to `words.json`.
- Reviews go to `progress.json`, created on the first sync that has something to save.

Sync runs when the app opens, about 15 seconds after you stop grading, and when you leave the app. A review session becomes one commit instead of one commit per card. Pushes that only change `progress.json` do not rebuild the site. A change to `words.json` still deploys, because the installed app loads that file from the build. **Sync now** is on the Today screen and in Settings. The line under the title reads `Last synced at <time>, commit <sha>` only after GitHub returns HTTP 200 or 201 with a commit. If GitHub refuses the token, the same line's message includes the status and GitHub's error text. "No reviews to send yet" means nothing was committed.

If GitHub says the file changed in the meantime, the app refetches, merges, and retries. Words merge by their `updated` time. The scheduling state keeps the later review, and the review logs from both devices are combined. Deleting a word writes a tombstone so an older copy does not come back.

`progress.json` version 2 stores, for each card, the hanzi, the direction (`read` or `write`), the scheduling fields, and a `reviews` array of `{ at, grade, direction }`.

The token is stored only in this device's IndexedDB. It is not written into `words.json`, `progress.json`, or the backup file. **Forget token** deletes it. Each phone needs the token pasted once.

`progress.json` lives in this repo. If the repo is public, review history is visible on GitHub. The Pages site does not publish that file.

### Create the token

1. On GitHub, open **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
2. Choose **Generate new token**.
3. Name it `Chinese flashcards` and pick an expiration you will remember.
4. Resource owner: your user account.
5. Repository access: **Only select repositories**, then choose `chinese-flashcards`.
6. Under **Repository permissions**, set **Contents** to **Read and write**. Leave every other permission at **No access**.
7. Generate the token and copy it. GitHub shows it only once.
8. In the app, open **Settings**, paste the token, tap **Save on this device**, then **Sync now**. After you update the app, swipe it away and open it again from the home screen so the new version replaces the saved copy. The token stays on the phone. Paste it again only if the token field is empty.

When the token expires, GitHub returns a 401 and the app asks you to paste a new one. Reviews already on the phone stay put.

## Backup

Settings → **Export JSON** downloads words and review progress. **Import JSON** merges that file into the current device. For each card, the later review is kept. Imported word edits are marked so the next sync can commit them.

## `words.json`

The file in the repo root is an array. Order is the order new cards are introduced. An entry looks like this:

```json
{
  "id": "riluo",
  "hanzi": "日落",
  "pinyin": "rì luò",
  "meaning": "sunset",
  "example": {
    "hanzi": "日落很美。",
    "pinyin": "Rì luò hěn měi.",
    "english": "The sunset is beautiful."
  },
  "tags": ["compound"],
  "added": "2026-10-31",
  "updated": "2026-10-31T00:00:00.000Z"
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Stable id. Cards are stored as `id:read` and `id:write`. Do not change it after reviews exist. |
| `hanzi` | yes | The characters shown on the Read face. |
| `pinyin` | yes | Tone marks, with a space between syllables (`nǐ hǎo`). The app can also split unspaced pinyin. |
| `meaning` | yes | Short English gloss. |
| `example` | no | `hanzi`, `pinyin`, and `english`. |
| `tags` | no | For example `hsk1`, `day1`, `radical`, `compound`. Search matches tags. |
| `added` | yes | `YYYY-MM-DD`. |
| `updated` | no | ISO time. Sync keeps the newer edit. Set this to now if you put a deleted word back by hand. |

The starter deck includes Day 1 (人, 口, 日, 月, 明, 水, 女, 好), 日落, and common HSK 1 words such as 你好, 谢谢, 中国, 飞机, and 朋友.

You can edit `words.json` in the repo. The next sync, or the next Pages deploy for a phone that has no token, picks up the change. A word removed from the file is deleted on sync unless this device still has an unsynced edit of it.

## Develop

```bash
npm install
npm test
npm run dev
```

Open [http://localhost:5173/chinese-flashcards/](http://localhost:5173/chinese-flashcards/). The base path matches GitHub Pages.

```bash
npm run build
npm run preview
```

## Deploy

Pushes to `main` run `.github/workflows/pages.yml`. The workflow tests, builds, and deploys the `dist` folder to GitHub Pages. The Pages source has to be **GitHub Actions** (Settings → Pages → Build and deployment).
