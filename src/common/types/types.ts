import {
  BookingStatus,
  VisaType,
} from '../../database/entities/booking.entity';

export type TimeRange = {
  startAt: Date;
  endAt: Date;
};

export type SchedulingBooking = {
  startAt: Date;
  endAt: Date;
  visaType: VisaType;
  status: BookingStatus;
  expiresAt: Date;
};

// How long a requested slot is held for the advisor to confirm, in minutes.
export const HOLD_DURATION_MINUTES = 10;

// All values in minutes.
export const VISARULES = {
  [VisaType.A]: {
    duration: 30,
    buffer: 5,
  },
  [VisaType.B]: {
    duration: 60,
    buffer: 10,
  },
};
