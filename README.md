# Home Maintenance

A self-hosted tracker for everything that's easy to forget about a house: recurring upkeep, who to call, what it cost, appliance warranties and lifespans, receipts and manuals, and a list of needs and projects. Reminders arrive as push notifications on your phone.

Built for a QNAP NAS (Container Station or K3s) but runs anywhere Docker does. One container, one SQLite file, your data stays on your network. An optional AI assistant is the only feature that talks to an outside service, and it is off unless you turn it on.

## What it does

| Screen | What you get |
| --- | --- |
| **Dashboard** | Home Score, budget remaining, what needs attention, warranties ending soon, aging equipment, projects in progress |
| **Maintenance** | Recurring items with a service month, vendor and cost. **Mark done** logs the date, cost and an optional receipt, and moves the next due date forward. Snooze, request service from a vendor, and a **12-month planner** with a cost forecast |
| **Suggestions** | About 50 common upkeep tasks, matched to your home's features and the season. One tap adds one to your list |
| **Appliances** | Warranty countdown, expected lifespan and replacement estimate, model and serial numbers, and attached paperwork |
| **Projects** | Needs and bigger jobs with priority, status, cost, contractor **quote comparison**, and a message generator for requesting quotes |
| **Documents** | Warranties, receipts, manuals and photos, searchable, and linked to the appliance, job, project or vendor they belong to |
| **Log** | Every job, repair, upgrade and inspection with costs. Export to CSV for taxes or insurance |
| **Vendors** | Your trusted pros with trade, rating, tap-to-call phone numbers and history |
| **My Home** | Home details, what the house has (drives Suggestions), quick-reference facts such as shutoff locations and filter sizes, and the Home Score breakdown. Also opens the printable **Home report** |
| **Assistant** | Optional. Describe a problem, or attach a photo, and get likely causes, next steps and whether to call a pro. See [The assistant](#the-assistant-optional) |
| **Settings** | Push notifications, calendar feed, backups |

Press **/** anywhere to search across everything.

### How the schedule works

A yearly item with a service month (say HVAC in April) is due *during* that month, so it isn't "overdue" until the month ends. Finishing early or late keeps it on the same month next year. Items with no month stay "Unscheduled" and never send reminders until you set one. Items with no history are scheduled for the next upcoming occurrence of their month. **Snoozing** hides an item and pauses its reminders until a date, but it still counts as overdue in your Home Score, and marking it done clears the snooze.

### Home Score

A 0 to 100 measure of how well the house is being looked after. It is a simple heuristic, not an appraisal, and every part tells you what would improve it:

| Part | Points | Measures |
| --- | --- | --- |
| Schedule health | 40 | Scheduled items that are not overdue |
| Planning | 20 | Items that have a schedule at all |
| Records | 15 | Appliances with purchase and warranty details and a document on file |
| Equipment age | 10 | Appliances not past their expected life |
| Follow-through | 15 | Work logged in the last 12 months compared with items being tracked |

### Budget

Spent = maintenance and repair costs logged in the year + actual cost of needs and projects completed that year. "Still expected" = estimated cost of maintenance due this year, including overdue items. The budget carries forward year to year until you change it.

## Run it locally

Needs Node 24 or newer.

```bash
npm install
npm start          # http://localhost:8080, data in ./data
npm test           # unit and integration tests
```

The first start loads your starter list from `seed.json` (edit it before the first run, or delete items in the app). Set `SEED=false` to start empty.

## Deploy on QNAP Container Station

**1. Get the image onto the NAS.** Pick one:

- **From GitHub (recommended).** Push this folder to a GitHub repo. The workflow in `.github/workflows/docker.yml` tests it and publishes `ghcr.io/clashi5050/home-maintenance` on every push to `main`. After the first build, open the package on GitHub > Package settings and make it **public** so the NAS can pull it without a login.
- **Without a registry.** On a PC with Docker: `docker build -t home-maintenance:latest .` then `docker save home-maintenance:latest -o home-maintenance.tar`. In Container Station: **Images > Import** and choose the tar.

**2. Create the app.** Container Station > **Applications > Create**, paste `deploy/docker-compose.yml` (for the tar route, change the image to `home-maintenance:latest`), and create it.

**3. Open** `http://<NAS-IP>:8085`. Port 8085 is used because QTS itself owns 8080.

**Upgrading** to a new version keeps your data. The database upgrades itself on start, and your documents are in the same volume.

## Deploy on K3s (Kubernetes)

Either run `kubectl apply -f deploy/k8s/home-maintenance.yaml` or upload the file in the Kubernetes Dashboard under **Create > Create from file**.

It creates a `home-maintenance` namespace, a 1 GiB volume claim (raise it if you store lots of documents), a single-replica Deployment (`Recreate`, because SQLite allows one writer), and a NodePort service on **30085**. Open `http://<NAS-IP>:30085`. If that doesn't respond, check which node ports the `qnap-k3s` container forwards in Container Station and adjust `nodePort`.

K3s on Container Station runs inside its own container, so it can't see images imported into Docker. Use the GitHub route (public package), or import the tar into K3s (`docker cp home-maintenance.tar qnap-k3s:/tmp/`, then `docker exec qnap-k3s k3s ctr images import /tmp/home-maintenance.tar`) and set `imagePullPolicy: IfNotPresent`.

## Push notifications (ntfy)

1. Install the free **ntfy** app on each phone (iOS or Android).
2. In the app, subscribe to a topic name that is long and hard to guess, for example `smith-house-7x2k9`. On the public ntfy.sh server, anyone who knows a topic name can read it.
3. In **Settings**, turn on *Send reminders*, enter the same topic, and press **Send test**.
4. Optional: enter this app's address (for example `http://192.168.1.50:8085`) so tapping a notification opens the app.

You get one digest per day at the time you choose. It covers items that are coming up (default 14 days ahead), due this month, or overdue (repeated weekly), warranties ending within 60 days, and equipment reaching the end of its expected life. Each reminder is sent once. Snoozed items stay quiet. The vendor's phone number is included so you can call from the notification. **Check now** in Settings runs the same check on demand.

To keep everything on your network, run your own [ntfy server](https://docs.ntfy.sh/install/) as another container and put its URL in Settings.

## Calendar feed

Settings and the Year planner show a calendar address (`/api/calendar.ics`). Subscribe to it in Google Calendar, Apple Calendar or Outlook to see due dates, warranty ends and equipment lifespans alongside your other plans. It refreshes as you change things. Your phone needs to reach the server, so on a home network it works while you're on your Wi-Fi. If you set `BASIC_AUTH`, include the login in the subscription address or use a client that supports it.

## The assistant (optional)

Describe a problem, or attach a photo, and it replies with the likely causes, ordered next steps, whether to do it yourself or call a pro (and which trade), a safety note when relevant, and a one-tap "add to my list". It knows your home's year built, features, equipment and their ages, and which maintenance is overdue.

It is **off by default** and works only when you set `ANTHROPIC_API_KEY`. It uses the [Anthropic API](https://docs.anthropic.com), so it needs a key from your own account and is billed per question.

- **Enable:** add `ANTHROPIC_API_KEY` to the container's environment (the commented line in `deploy/docker-compose.yml`) and restart. On Kubernetes:

  ```bash
  kubectl -n home-maintenance create secret generic home-maintenance-secrets --from-literal=anthropic-api-key='sk-ant-...'
  kubectl -n home-maintenance rollout restart deployment/home-maintenance
  ```

- **What is sent:** your message, any photo (shrunk and stripped of location data in your browser first), and a short summary of the home: year built, size, features, equipment with ages, overdue item names. **Your address, insurance details and purchase price are never sent.** Photos are not stored by this app.
- **Model:** `claude-opus-5` by default. Set `ASSISTANT_MODEL` to use another. Refusals are retried on Anthropic's recommended fallback model automatically.
- **Limits:** 20 questions per hour by default (`ASSISTANT_RATE_PER_HOUR`), so a stuck script or a curious child can't run up a bill.
- **It is advice, not a diagnosis.** For anything involving gas, electrical hazards, flooding or structural movement, treat the answer as a prompt to call a professional.

## Documents

Upload PDFs, photos and common office files up to 25 MB each (`MAX_UPLOAD_MB`). Files live on disk in the data volume; details live in the database. Uploads are checked against an allow-list of types and each file's actual contents, and files are served with headers that stop them from ever running as a web page.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Port inside the container |
| `DATA_DIR` | `/data` | Database and uploaded files (mount a volume here) |
| `TZ` | `America/New_York` | Time zone for "today" and the daily reminder time |
| `BASIC_AUTH` | *(off)* | `user:password` to require a login for the whole app |
| `SEED` | `true` | Load `seed.json` on the first start only |
| `MAX_UPLOAD_MB` | `25` | Largest document upload |
| `ANTHROPIC_API_KEY` | *(off)* | Turns on the Assistant |
| `ASSISTANT_MODEL` | `claude-opus-5` | Model the Assistant uses |
| `ASSISTANT_RATE_PER_HOUR` | `20` | Cap on Assistant questions per hour |

## Data, backups and privacy

Everything is in the data volume: `home-maintenance.db` plus a `files/` folder of documents. **Include that volume in your NAS backups.** **Settings > Data backup** also downloads a JSON copy of the records (not the files), and the Log exports to CSV.

There is no login by default, which is fine on a home network and shared by everyone in the household. Set `BASIC_AUTH` before you expose it any other way, and put it behind HTTPS if it leaves your network.

## Project layout

```
server/      dates, scheduling, SQLite schema and migrations, REST API, notifications,
             documents, planner and calendar feed, search, report, assistant
public/      the web app: vanilla JS modules, no build step, no external requests
  views/     one module per screen
test/        unit and integration tests (node --test)
deploy/      Container Station compose file and Kubernetes manifest
seed.json    your starter list, loaded on first run
```
