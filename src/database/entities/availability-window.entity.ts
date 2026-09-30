import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../abstracts/base.entity';
import { Advisor } from './advisor.entity';

@Unique(['advisorId', 'startAt'])
@Entity('availability_windows')
export class AvailabilityWindow extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @JoinColumn({ name: 'advisor_id' })
  @ManyToOne(() => Advisor, (advisor) => advisor.availabilityWindows, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  advisor!: Advisor;

  @Column({ name: 'advisor_id', length: 25 })
  advisorId!: string;

  @Column({ type: 'timestamptz' })
  startAt!: Date;

  @Column({ type: 'timestamptz' })
  endAt!: Date;
}
