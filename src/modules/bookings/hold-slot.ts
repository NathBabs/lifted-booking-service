import { EntityManager } from 'typeorm';
import { HOLD_DURATION_MINUTES } from '../../common/types/types';
import {
  Booking,
  BookingStatus,
  ConfirmationRequiredBy,
  VisaType,
} from '../../database';
import { AvailableSlot } from '../availability/availability.service';

const HOLD_DURATION_MS = HOLD_DURATION_MINUTES * 60_000;

// Used by direct booking (advisor confirms) and waitlist offers (candidate confirms).
export function holdSlot(
  manager: EntityManager,
  {
    slot,
    candidateName,
    visaType,
    confirmationRequiredBy,
    now,
  }: {
    slot: AvailableSlot;
    candidateName: string;
    visaType: VisaType;
    confirmationRequiredBy: ConfirmationRequiredBy;
    now: Date;
  },
): Promise<Booking> {
  return manager.save(
    manager.create(Booking, {
      advisorId: slot.advisorId,
      candidateName,
      visaType,
      startAt: slot.startAt,
      endAt: slot.endAt,
      status: BookingStatus.HELD,
      expiresAt: new Date(now.getTime() + HOLD_DURATION_MS),
      confirmationRequiredBy,
    }),
  );
}
