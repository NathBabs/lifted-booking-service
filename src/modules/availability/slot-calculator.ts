import {
  SchedulingBooking,
  TimeRange,
  VISARULES,
} from '../../common/types/types';
import { BookingStatus, VisaType } from '../../database';

const MINUTE_MS = 60_000;

// We use epoch milliseconds internally to keep the math simple.
// Note: Ranges are half-open [start, end), so 10:00-10:30 and 10:30-11:00 touch but don't overlap.
export interface MsRange {
  start: number;
  end: number;
}

// Figures out bookable slots for a single advisor.
// We look at all their windows and bookings together because a booking's
// break can bleed into the next window.
export function calculateSlots(
  availabilityWindows: TimeRange[],
  bookings: SchedulingBooking[],
  requestedVisaType: VisaType,
  now: Date,
): TimeRange[] {
  const { duration, buffer } = VISARULES[requestedVisaType];
  const durationMs = duration * MINUTE_MS;
  const bufferMs = buffer * MINUTE_MS;

  const blockedRanges = bookings
    .filter((booking) => isBlocking(booking, now))
    .map(toBlockedRange)
    .sort((a, b) => a.start - b.start);

  const windows = availabilityWindows
    .map((window) => ({
      start: window.startAt.getTime(),
      end: window.endAt.getTime(),
    }))
    .sort((a, b) => a.start - b.start);

  const slots: MsRange[] = [];

  for (const window of windows) {
    // Keep track of where we are in the current window.
    let cursor = window.start;

    for (const blocked of blockedRanges) {
      // Skip past bookings we've already passed.
      if (blocked.end <= cursor) continue;

      // There's a gap before this booking, so try to fit slots into it. We stop
      // early by the requested buffer, because the advisor needs that break
      // before the next booking starts.
      if (blocked.start > cursor) {
        const latestEnd = Math.min(window.end, blocked.start - bufferMs);
        slots.push(...generateSlotsInGap(cursor, latestEnd, durationMs));
      }

      // Move our cursor past this booking and its buffer.
      // Using max() here safely handles overlapping bookings.
      cursor = Math.max(cursor, blocked.end);
      if (cursor >= window.end) break;
    }

    // If we still have time left at the end of the window, fill it with slots.
    // No need to worry about the buffer here since there's no booking after it.
    if (cursor < window.end) {
      slots.push(...generateSlotsInGap(cursor, window.end, durationMs));
    }
  }

  return slots.map(toTimeRange);
}

// Checks if a booking actually still blocks the advisor's schedule right now.
export function isBlocking(booking: SchedulingBooking, now: Date): boolean {
  switch (booking.status) {
    case BookingStatus.CONFIRMED:
      return true;
    case BookingStatus.HELD:
      // Treat expired holds as free, even if the background job hasn't updated the status yet.
      return booking.expiresAt.getTime() > now.getTime();
    default:
      // EXPIRED, CANCELLED
      return false;
  }
}

// Works out how long a booking blocks the advisor: the appointment itself plus
// the break its own visa type needs afterwards.
export function toBlockedRange(booking: SchedulingBooking): MsRange {
  const { buffer } = VISARULES[booking.visaType];

  return {
    start: booking.startAt.getTime(),
    end: booking.endAt.getTime() + buffer * MINUTE_MS,
  };
}

// Generates back-to-back slots of a specific duration that fit into a given gap.
function generateSlotsInGap(
  from: number,
  latestEnd: number,
  durationMs: number,
): MsRange[] {
  const slots: MsRange[] = [];

  for (let start = from; start + durationMs <= latestEnd; start += durationMs) {
    slots.push({ start, end: start + durationMs });
  }

  return slots;
}

function toTimeRange({ start, end }: MsRange): TimeRange {
  return { startAt: new Date(start), endAt: new Date(end) };
}
