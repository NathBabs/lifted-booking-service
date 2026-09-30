# Lifted Immigration Advisor Booking API

### Take-home assessment for Lifted.

A small NestJS API for managing immigration advisor availability, temporary booking holds, confirmations, and waitlist allocation.

The main focus of the implementation is scheduling correctness: deriving bookable slots from arbitrary availability windows, respecting consultation durations and advisor breaks, preventing concurrent double-booking, and making sure expired holds do not continue blocking capacity.

## How to Run

### Requirements

- Node.js 22.12 or newer
- pnpm
- PostgreSQL

### Install dependencies

```bash
pnpm install
```

### Environment variables

Copy the sample and adjust it for your local PostgreSQL:

```bash
cp .env.sample .env
```

```env
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres
DATABASE_NAME=lifted_booking
```

`PORT` is optional and defaults to `3000`.

### Create the database and run migrations

Create the database named in `DATABASE_NAME`, then run the migrations:

```bash
createdb lifted_booking
pnpm migration:run
```

### Seed the supplied advisor data

```bash
pnpm seed
```

The seed command validates the supplied JSON before writing it to PostgreSQL. It is safe to run more than once.

### Start the API

```bash
pnpm start:dev
```

### Run tests

```bash
pnpm test
```

These are Jest unit tests and don't need a database.

---

## API

| Method | Path                                       | Purpose                                                                      |
| ------ | ------------------------------------------ | ---------------------------------------------------------------------------- |
| GET    | `/availability?visaType=A&date=2025-03-10` | Bookable slots for that UTC day across all advisors                          |
| POST   | `/bookings`                                | `{ candidateName, visaType, date }` → `201` hold, or `202` waitlisted        |
| GET    | `/bookings`                                | All bookings                                                                 |
| POST   | `/bookings/:id/confirm`                    | Advisor confirms a hold within its 10 minutes                                |
| POST   | `/bookings/:id/cancel`                     | Cancel a confirmed booking or live hold; the freed time goes to the waitlist |
| GET    | `/waitlist`                                | Waitlist entries, oldest first                                               |
| POST   | `/waitlist/:id/accept`                     | Candidate accepts an offer; the booking becomes confirmed                    |
| POST   | `/waitlist/:id/cancel`                     | Leave the queue, or decline an offer                                         |

Responses use `{ statusCode, message, data }`. Errors use Nest's `{ statusCode, message, error }`.

For example:

```bash
curl -s -X POST localhost:3000/bookings \
  -H 'content-type: application/json' \
  -d '{"candidateName":"Ada Obi","visaType":"A","date":"2025-03-10"}'
```

---

## Tech Choices

### NestJS

I used NestJS because I have used it for years and it is battle-tested. Its opinionated, module-based structure also encourages a well-organised modular monolith, which is a large part of why it has become a popular enterprise framework for Node.js.

The project is kept intentionally small rather than introducing modules or abstractions for every database entity.

### PostgreSQL

The scheduling guarantees rely on transactions, row locks (`SELECT ... FOR UPDATE`) and `timestamptz`, all of which PostgreSQL handles well.

### TypeORM

I used TypeORM because it integrates cleanly with NestJS while still giving direct access to transactions, `EntityManager`, query builders, and PostgreSQL locking when the scheduling logic needs them. It is also a mature ORM with first-class NestJS support.

### @nestjs/schedule

Runs the hold-expiry job every 5 seconds inside the application, which is enough for this assessment (see [Background expiry](#background-expiry)).

### class-validator

Request and seed-data validation use `class-validator`.

The supplied availability JSON is treated as external input rather than trusted application data, so its structure and date ranges are validated before persistence.

---

## Availability Model

The supplied availability windows are stored exactly as received.

I do not pre-generate fixed slot rows in the database.

For example:

```text
09:33 --------------------------- 11:30
```

remains a single availability window.

Bookable slots are derived dynamically for the requested visa type.

```http
GET /availability?visaType=A&date=2025-03-10
```

Visa rules are:

| Visa type |   Duration |      Break |
| --------- | ---------: | ---------: |
| A         | 30 minutes |  5 minutes |
| B         | 60 minutes | 10 minutes |

The same availability window can therefore produce different results depending on the visa type being requested.

Slots start from the beginning of each effective free interval and advance by the consultation duration.

For example:

```text
Availability:
09:33 → 11:30

Type A:
09:33 → 10:03
10:03 → 10:33
10:33 → 11:03
```

I deliberately do not round external availability to cleaner clock boundaries such as `09:35` or `10:00`, because that would discard valid availability without a business requirement to do so.

---

## Break Handling

Breaks are required between consecutive appointments.

For example, a confirmed Type A booking:

```text
09:00 → 09:30
```

means the next appointment cannot start before:

```text
09:35
```

Active holds also reserve their potential break. Otherwise a second booking could be accepted that would become invalid if the first hold were confirmed.

A break only matters when another appointment follows.

An appointment can end exactly at the end of a window. For example, if an advisor is available until `10:00`, a Type B booking from `09:00–10:00` is valid.

But if the advisor's next window has a booking that starts within the new appointment's break, the break still applies. With a booking at `09:33` in the next window, a Type A `09:00–09:30` is not offered, because it would leave only three of the five minutes it needs. A booking hours later has no effect.

### Breaks across separate availability windows

The supplied data contains an interesting case:

```text
09:00 → 09:30
09:33 → 11:30
```

I keep these as separate windows.

If `09:00–09:30` becomes a Type A booking, its required break lasts until `09:35`.

The next window therefore becomes usable from `09:35`.

The three-minute gap already contributes to the five-minute break; another five minutes is not added from `09:33`.

This is why slot calculation considers an advisor's relevant windows and bookings together rather than treating each window completely independently.

---

## Booking Allocation

A booking request contains the candidate name, visa type, and requested date.

The system chooses the advisor and slot automatically.

When several slots are available, the allocation order is deterministic:

```text
1. Earliest available start
2. Advisor ID as a tie-breaker
```

A successful request creates a booking with:

```text
status = HELD
expiresAt = now + 10 minutes
confirmationRequiredBy = ADVISOR
```

If no slot fits, the candidate is added to the waitlist instead (see [Waitlist](#waitlist)).

The IA can confirm the booking during that hold period.

A confirmed booking or a live hold can be cancelled. A hold that has already lapsed can't, since it no longer holds anything.

---

## Concurrency

The main concurrency risk is two candidates seeing the same slot as free before either booking has been inserted.

For the assessment, booking allocation runs inside a PostgreSQL transaction and locks the rows of every advisor with availability that day using `SELECT ... FOR UPDATE`.

The flow is:

```text
BEGIN

find the advisors with availability that day

lock those advisors

settle the day: expire lapsed holds and offer freed time to the waitlist

read current bookings

recalculate availability

choose the earliest slot

insert HELD booking (or join the waitlist if nothing fits)

COMMIT
```

Advisor locks are always taken in advisor ID order, so concurrent requests queue rather than deadlock.

The same lock is used by every operation that creates a hold or depends on one still being valid:

- booking requests lock the whole day's advisors;
- advisor confirmation and waitlist acceptance lock the booking's advisor, so a hold can't be confirmed at the same moment its time is given to someone else;
- cancellation, declining a waitlist offer, and the expiry job lock the whole day's advisors before releasing anything, then reallocate the freed time in the same transaction.

Read-only endpoints (`GET /availability`, `GET /bookings`, `GET /waitlist`) take no locks.

Availability is deliberately recalculated inside the transaction rather than trusting an earlier response from `GET /availability`.

This means the availability endpoint is a point-in-time view, while booking creation is authoritative.

### Why not hold a database lock for 10 minutes?

The 10-minute reservation is business state, not a database critical section.

Keeping a PostgreSQL or advisory lock alive for the duration of the hold would unnecessarily tie reservation lifetime to a database connection and would scale poorly.

### Why not Redis distributed locks?

Redis could provide TTL-based locking, but PostgreSQL already owns the authoritative booking state.

For this task I preferred one source of truth and short database transactions over introducing distributed lock ownership and another failure mode.

Redis could still be useful in a larger system for caching, rate limiting, or other non-authoritative work.

### Why not only use SERIALIZABLE isolation?

PostgreSQL `SERIALIZABLE` isolation could also prevent conflicting allocations, but conflicting transactions may be aborted and need application-level retry handling.

Explicit row locking made the concurrency behaviour simpler to reason about and demonstrate for this assessment.

---

## Hold Expiration

A hold is logically active only while:

```text
status = HELD
and
expiresAt > now
```

An expired hold therefore stops blocking availability immediately, even if the background job has not yet updated its stored status to `EXPIRED`. `GET /bookings` also reports such a hold as `EXPIRED`.

This separates booking correctness from background processing.

A scheduled job runs every 5 seconds. For each day with lapsed holds, it locks that day's advisors, marks the holds `EXPIRED`, closes any waitlist offers they belonged to, and offers the freed time to that day's waitlist.

Booking requests run the same reconciliation for their day before allocating, so the waitlist's priority doesn't depend on when the job last ran.

---

## Waitlist

If no slot fits, the candidate is added to the waitlist for their requested date and visa type, and the request returns `202 Accepted` instead of a hold.

"First eligible candidate" is interpreted as the oldest waiting candidate whose consultation can fit the newly available capacity.

For example:

```text
1. Type B candidate
2. Type A candidate
```

If only a 30-minute appointment fits, the Type A candidate is offered it, and the Type B candidate keeps waiting on the queue.

### Priority assumption

The brief does not define what should happen if newly released capacity is simultaneously requested by a new candidate.

For this implementation I chose to give candidates already on the waitlist priority over new requests when capacity is released.

The reasoning is mainly UX: joining a waitlist should create a meaningful expectation that the system will offer newly available capacity to waiting candidates.

This is a product decision rather than a technical requirement, and an alternative such as "first successful transaction wins" would also be valid.

### Waitlist offers

When capacity becomes available, the system recalculates that day's availability and offers the earliest suitable slot to the oldest eligible waitlisted candidate. It keeps allocating while both suitable slots and eligible candidates remain.

I do not simply transfer the cancelled or expired booking's previous start/end time.

Removing a booking can change the shape of the surrounding free interval and may make different combinations of consultations possible.

A waitlist offer creates the same type of 10-minute hold as a normal booking, except:

```text
confirmationRequiredBy = CANDIDATE
```

instead of `ADVISOR`.

When the candidate accepts the offer, the booking is confirmed. I treat the candidate's acceptance as final, with no second confirmation from the advisor, since the brief gives the candidate the 10-minute window to confirm.

If the offer expires instead, that candidate leaves the waitlist and the next eligible candidate is offered the time. Otherwise the oldest candidate would be offered the same slot again indefinitely. They can make a new request if they still want an appointment.

A candidate can also leave the queue, or decline an offer, with `POST /waitlist/:id/cancel`. Declining releases the held time to the next eligible candidate straight away.

---

## Challenges and Trade-offs

### Scheduling is interval-based rather than slot-based

The supplied data contains irregular availability boundaries such as `09:33`, multiple windows on the same day, and different consultation durations.

I therefore modelled source availability as intervals and derived slots dynamically instead of assuming fixed 30-minute blocks.

This made the availability logic slightly more involved but avoids losing or inventing availability.

### Returned availability can change

The availability endpoint returns slots that are valid against the schedule at that moment.

Booking one of those options can make another previously returned option invalid because of appointment buffers.

Rather than trying to make availability responses permanent guarantees, booking creation recalculates availability transactionally before inserting a hold.

### Broad locking for the assessment

With only two advisors, locking all candidate advisor rows keeps the allocation logic simple and race-free.

This is intentionally broader than I would use in a high-volume production system.

At larger scale I would use optimistic candidate discovery, lock a narrower scheduling boundary, revalidate under that lock, and retry if the candidate slot had become stale.

### Background expiry

A lightweight scheduled process is sufficient for this assessment.

In production I would use durable scheduled jobs with retries, idempotency, failure visibility, and metrics rather than relying on in-process polling alone.

### The waitlist is settled on every booking request

Before serving a new request, the booking transaction reconciles that day: it expires lapsed holds and offers any freed capacity to the waitlist first.

This is how waitlisted candidates keep priority over newcomers even when the expiry job hasn't run yet. The cost is a little extra work on every booking request.

---

## What I Would Do Differently With More Time

For a production version I would prioritise:

- narrower locking so unrelated advisor/date allocations can proceed concurrently;
- fairer distribution of bookings between advisors: ties currently go to the lowest advisor ID, so one advisor takes every tied slot. I would break ties by current workload (for example, fewest bookings that day or week) or rotate between advisors, while keeping allocation deterministic;
- durable delayed jobs for hold expiry and waitlist processing;
- a transactional outbox for email/SMS/push notifications;
- stronger PostgreSQL overlap protection, potentially using range/exclusion constraints as defence in depth;
- production-grade synchronisation of external advisor availability, including updates, deletions, overlaps, source IDs, and reconciliation;
- explicit timezone handling rather than treating requested dates as UTC;
- more extensive concurrency and property-based scheduling tests;
- indexes tuned around booking allocation, expiration, and waitlist queries;
- metrics around lock contention, allocation latency, expired-hold processing, waitlist depth, and failed background jobs.

I would measure contention before introducing additional distributed infrastructure such as Redis.

---

## Testing

I focused testing on areas where scheduling bugs are most likely to occur. All tests are Jest unit tests (`pnpm test`) with the database mocked.

Slot calculation:

- Type A and Type B slot generation;
- multiple availability windows on the same day, kept separate;
- a booking's break extending into the advisor's next availability window;
- a booking in the next window cutting off time before it;
- a future booking reducing usable time before it;
- active, expired and cancelled holds;
- appointments ending exactly at an availability boundary;
- windows too short for any appointment.

Availability and bookings:

- bookings loaded with enough margin around the windows for their breaks to count;
- slots ordered by start time, with advisor ID as the tie-breaker;
- advisor locks taken before bookings are read, and before a hold is confirmed;
- lapsed or already-confirmed holds rejected on confirmation;
- cancellation locking the day, then handing the freed time to the waitlist.

Waitlist:

- the oldest eligible candidate offered first, while candidates who don't fit keep their place;
- offers repeating until nobody else fits;
- expired offers removing the candidate from the queue;
- accepting an offer, declining it, and leaving the queue.

These tests check that locks are taken, and in the right order, but they don't run real concurrent transactions. I checked concurrency manually by sending simultaneous booking requests to the running API and confirming that every hold got a different slot with its break respected. Automating that against a real database is one of the things I would add with more time.

---

## Use of AI

I used ChatGPT as a development and design assistant during the assessment.

I was already familiar with most of the concepts in a booking service from experience, so I mainly used it to challenge architectural decisions and explore edge cases around interval scheduling, database locking, hold expiration, and waitlist concurrency.

For example, I used it to reason through:

- whether a 10-minute hold should be implemented as a database/distributed lock or persisted booking state;
- races between concurrent booking requests;
- the confirmation-versus-expiry boundary;
- how advisor breaks interact with multiple availability windows;
- waitlist ordering and reassignment;
- alternatives such as PostgreSQL advisory locks, `SERIALIZABLE` isolation, Redis/distributed locks, and database exclusion constraints.

I also used it for code completion(Claude) to implement parts of that design under my direction, reviewing parts of the implementation and identifying cases worth testing.
