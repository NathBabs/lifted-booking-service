import { Booking, BookingStatus } from '../../database';

// A lapsed hold counts as expired even if the expiry job hasn't updated it yet.
export function effectiveStatus(
  booking: Pick<Booking, 'status' | 'expiresAt'>,
  now: Date,
): BookingStatus {
  const lapsed =
    booking.status === BookingStatus.HELD &&
    booking.expiresAt.getTime() <= now.getTime();

  return lapsed ? BookingStatus.EXPIRED : booking.status;
}
