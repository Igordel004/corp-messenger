import { describe, it, expect, vi } from 'vitest';
import { AdminService } from './admin';

const users = [
  {
    id: 'user-uuid-1',
    fullName: 'Анна Петрова',
    email: 'anna@corp.messenger.com',
    globalRole: 'USER' as const,
    status: 'ACTIVE' as const,
  },
  {
    id: 'user-uuid-2',
    fullName: 'Иван Иванов',
    email: 'ivan@corp.messenger.com',
    globalRole: 'ADMIN' as const,
    status: 'BLOCKED' as const,
  },
];

const createService = () => {
  const findMany = vi.fn().mockResolvedValue(users);
  const service = new AdminService({ user: { findMany } } as never);
  return { service, findMany };
};

describe('Unit Test: Реестр сотрудников', () => {
  it('возвращает весь реестр без поискового запроса', async () => {
    const { service, findMany } = createService();

    const result = await service.listUsers();

    expect(result).toEqual(users);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
  });

  it('фильтрует по имени и email одновременно без учёта регистра', async () => {
    const { service, findMany } = createService();

    await service.listUsers('  Иван  ');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { fullName: { contains: 'Иван', mode: 'insensitive' } },
            { email: { contains: 'Иван', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it('пустой поисковый запрос возвращает весь реестр', async () => {
    const { service, findMany } = createService();

    await service.listUsers('   ');

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
  });

  it('возвращает поля реестра: имя, email, роль и статус', async () => {
    const { service, findMany } = createService();

    await service.listUsers();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          fullName: true,
          email: true,
          globalRole: true,
          status: true,
        },
      }),
    );
  });
});
