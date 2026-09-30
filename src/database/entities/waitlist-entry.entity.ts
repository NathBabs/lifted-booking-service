import {
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../abstracts/base.entity';
import { Booking, VisaType } from './booking.entity';

export enum WaitlistStatus {
  WAITING = 'WAITING',
  OFFERED = 'OFFERED',
  FULFILLED = 'FULFILLED',
  // The offer lapsed. The candidate leaves the queue so the next one gets a turn.
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

// The allocator's lookup: WAITING entries for a day, oldest first.
@Index(['requestedDate', 'status', 'createdAt'])
@Entity('waitlist_entries')
export class WaitlistEntry extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 100 })
  candidateName!: string;

  @Column({ type: 'enum', enum: VisaType, enumName: 'waitlist_visa_type' })
  visaType!: VisaType;

  // UTC day, 'YYYY-MM-DD', same as the booking request.
  @Column({ type: 'date' })
  requestedDate!: string;

  @Column({
    type: 'enum',
    enum: WaitlistStatus,
    enumName: 'waitlist_status',
    default: WaitlistStatus.WAITING,
  })
  status!: WaitlistStatus;

  @JoinColumn({ name: 'offered_booking_id' })
  @OneToOne(() => Booking, { nullable: true, onDelete: 'SET NULL' })
  offeredBooking!: Booking | null;

  @Column({ name: 'offered_booking_id', type: 'uuid', nullable: true })
  offeredBookingId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  offeredAt!: Date | null;
}
