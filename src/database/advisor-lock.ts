import { EntityManager } from 'typeorm';
import { Advisor } from './entities/advisor.entity';

// Anything that creates a hold, or relies on one still being valid, takes this
// lock first. Always locked in id order so two callers can't deadlock.
export async function acquireAdvisorLocks(
  manager: EntityManager,
  advisorIds: string[],
): Promise<void> {
  if (advisorIds.length === 0) return;

  await manager
    .getRepository(Advisor)
    .createQueryBuilder('advisor')
    .select('advisor.id')
    .where('advisor.id IN (:...advisorIds)', { advisorIds })
    .orderBy('advisor.id')
    .setLock('pessimistic_write')
    .getMany();
}
