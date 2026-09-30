import { SchedulingBooking, TimeRange } from '../../common/types/types';
import { BookingStatus, VisaType } from '../../database';
import { calculateSlots } from './slot-calculator';

// All timelines are on 2025-03-10 (UTC), matching the seed data.
const at = (hhmm: string) => new Date(`2025-03-10T${hhmm}:00Z`);
const NOW = at('08:00');

const window = (start: string, end: string): TimeRange => ({
  startAt: at(start),
  endAt: at(end),
});

const booking = (
  visaType: VisaType,
  start: string,
  end: string,
  status = BookingStatus.CONFIRMED,
  expiresAt = at('23:59'),
): SchedulingBooking => ({
  visaType,
  startAt: at(start),
  endAt: at(end),
  status,
  expiresAt,
});

const hhmm = (date: Date) => date.toISOString().slice(11, 16);
const format = (slots: TimeRange[]) =>
  slots.map((slot) => `${hhmm(slot.startAt)}-${hhmm(slot.endAt)}`);

describe('calculateSlots', () => {
  it('1. fills an empty window back to back; the last break may run past the window end', () => {
    const slots = calculateSlots(
      [window('09:00', '10:00')],
      [],
      VisaType.A,
      NOW,
    );

    expect(format(slots)).toEqual(['09:00-09:30', '09:30-10:00']);
  });

  it('2. leaves room for the new booking’s break before an existing booking, and waits for the existing booking’s break after it', () => {
    const slots = calculateSlots(
      [window('09:00', '12:00')],
      [booking(VisaType.A, '10:00', '10:30')],
      VisaType.A,
      NOW,
    );

    expect(format(slots)).toEqual([
      '09:00-09:30', // 09:30-10:00 would leave no break before 10:00
      '10:35-11:05', // existing booking blocks until 10:30 + 5m
      '11:05-11:35',
    ]);
  });

  it('3. uses the requested type’s duration and break (B needs 60m + 10m before the next booking)', () => {
    const slots = calculateSlots(
      [window('09:00', '12:00')],
      [booking(VisaType.A, '10:00', '10:30')],
      VisaType.B,
      NOW,
    );

    expect(format(slots)).toEqual(['10:35-11:35']);
  });

  it('4. uses the existing booking’s own break (B blocks for 10m afterwards)', () => {
    const slots = calculateSlots(
      [window('09:00', '11:00')],
      [booking(VisaType.B, '09:00', '10:00')],
      VisaType.A,
      NOW,
    );

    expect(format(slots)).toEqual(['10:10-10:40']);
  });

  it('5. ignores a hold whose expiry has passed, even though its status is still HELD', () => {
    const lapsedHold = booking(
      VisaType.A,
      '10:00',
      '10:30',
      BookingStatus.HELD,
      at('07:55'), // before NOW
    );

    const slots = calculateSlots(
      [window('09:00', '11:00')],
      [lapsedHold],
      VisaType.A,
      NOW,
    );

    expect(format(slots)).toEqual([
      '09:00-09:30',
      '09:30-10:00',
      '10:00-10:30',
      '10:30-11:00',
    ]);
  });

  it('treats an active hold exactly like a confirmed booking', () => {
    const activeHold = booking(
      VisaType.A,
      '10:00',
      '10:30',
      BookingStatus.HELD,
      at('08:05'), // after NOW
    );

    const slots = calculateSlots(
      [window('09:00', '11:00')],
      [activeHold],
      VisaType.A,
      NOW,
    );

    expect(format(slots)).toEqual(['09:00-09:30']);
  });

  it('ignores cancelled bookings', () => {
    const slots = calculateSlots(
      [window('09:00', '10:00')],
      [booking(VisaType.A, '09:00', '09:30', BookingStatus.CANCELLED)],
      VisaType.A,
      NOW,
    );

    expect(format(slots)).toEqual(['09:00-09:30', '09:30-10:00']);
  });

  describe("across Rajan's split windows (09:00-09:30 and 09:33-11:30)", () => {
    const rajanWindows = [window('09:00', '09:30'), window('09:33', '11:30')];

    it('keeps the windows separate: the 09:30-09:33 gap is not bookable and 09:33 starts its own grid', () => {
      const slots = calculateSlots(rajanWindows, [], VisaType.A, NOW);

      // Merged into 09:00-11:30 this would wrongly be 09:00, 09:30, 10:00, ...
      expect(format(slots)).toEqual([
        '09:00-09:30',
        '09:33-10:03',
        '10:03-10:33',
        '10:33-11:03',
      ]);
    });

    it('6. a booking at the start of the second window removes the first window (only a 3-minute break)', () => {
      const slots = calculateSlots(
        rajanWindows,
        [booking(VisaType.A, '09:33', '10:03')],
        VisaType.A,
        NOW,
      );

      expect(format(slots)).toEqual(['10:08-10:38', '10:38-11:08']);
    });

    it('7. a booking in the first window pushes the second window’s start from 09:33 to 09:35', () => {
      const slots = calculateSlots(
        rajanWindows,
        [booking(VisaType.A, '09:00', '09:30')],
        VisaType.A,
        NOW,
      );

      expect(format(slots)).toEqual([
        '09:35-10:05',
        '10:05-10:35',
        '10:35-11:05',
      ]);
    });
  });

  it('returns nothing for a window shorter than the appointment (Sofia, 11 March, 14:00-14:20)', () => {
    const slots = calculateSlots(
      [window('14:00', '14:20')],
      [],
      VisaType.A,
      NOW,
    );

    expect(slots).toEqual([]);
  });

  it('does not depend on the order windows and bookings are passed in', () => {
    const slots = calculateSlots(
      [window('09:33', '11:30'), window('09:00', '09:30')],
      [
        booking(VisaType.A, '10:35', '11:05'),
        booking(VisaType.A, '09:00', '09:30'),
      ],
      VisaType.A,
      NOW,
    );

    // 09:35 is after the first booking's break; 10:05-10:35 would leave no
    // break before 10:35; after 11:10 there's too little left before 11:30.
    expect(format(slots)).toEqual(['09:35-10:05']);
  });
});
