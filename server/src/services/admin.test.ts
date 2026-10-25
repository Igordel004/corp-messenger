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
  const update = vi.fn().mockResolvedValue(users[1]);
  const service = new AdminService({ user: { findMany, update } } as never);
  return { service, findMany, update };
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

describe('Unit Test: Изменение статуса пользователя', () => {
  it('блокировка меняет статус на BLOCKED', async () => {
    const { service, update } = createService();

    const result = await service.setUserStatus('admin-uuid-1', 'user-uuid-2', 'BLOCKED');

    expect(result.status).toBe('updated');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-uuid-2' },
        data: { status: 'BLOCKED' },
      }),
    );
  });

  it('разблокировка восстанавливает статус ACTIVE', async () => {
    const { service, update } = createService();

    const result = await service.setUserStatus('admin-uuid-1', 'user-uuid-2', 'ACTIVE');

    expect(result.status).toBe('updated');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'ACTIVE' } }));
  });

  it('запрещает администратору менять собственный статус', async () => {
    const { service, update } = createService();

    const result = await service.setUserStatus('admin-uuid-1', 'admin-uuid-1', 'BLOCKED');

    expect(result).toEqual({ status: 'self_forbidden' });
    expect(update).not.toHaveBeenCalled();
  });

  it('возвращает not_found для несуществующего пользователя', async () => {
    const { service, update } = createService();
    update.mockRejectedValue({ code: 'P2025' });

    const result = await service.setUserStatus('admin-uuid-1', 'ghost-uuid', 'BLOCKED');

    expect(result).toEqual({ status: 'not_found' });
  });

  it('пробрасывает прочие ошибки базы данных', async () => {
    const { service, update } = createService();
    update.mockRejectedValue(new Error('connection lost'));

    await expect(service.setUserStatus('admin-uuid-1', 'user-uuid-2', 'BLOCKED')).rejects.toThrow(
      'connection lost',
    );
  });
});

describe('Unit Test: Изменение глобальной роли', () => {
  it('назначает роль ADMIN', async () => {
    const { service, update } = createService();

    const result = await service.setGlobalRole('admin-uuid-1', 'user-uuid-2', 'ADMIN');

    expect(result.status).toBe('updated');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-uuid-2' },
        data: { globalRole: 'ADMIN' },
      }),
    );
  });

  it('снимает роль ADMIN', async () => {
    const { service, update } = createService();

    const result = await service.setGlobalRole('admin-uuid-1', 'user-uuid-2', 'USER');

    expect(result.status).toBe('updated');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { globalRole: 'USER' } }));
  });

  it('запрещает администратору менять собственную роль', async () => {
    const { service, update } = createService();

    const result = await service.setGlobalRole('admin-uuid-1', 'admin-uuid-1', 'USER');

    expect(result).toEqual({ status: 'self_forbidden' });
    expect(update).not.toHaveBeenCalled();
  });

  it('возвращает not_found при смене роли несуществующего пользователя', async () => {
    const { service, update } = createService();
    update.mockRejectedValue({ code: 'P2025' });

    const result = await service.setGlobalRole('admin-uuid-1', 'ghost-uuid', 'ADMIN');

    expect(result).toEqual({ status: 'not_found' });
  });

  it('пробрасывает прочие ошибки базы данных', async () => {
    const { service, update } = createService();
    update.mockRejectedValue(new Error('connection lost'));

    await expect(service.setGlobalRole('admin-uuid-1', 'user-uuid-2', 'ADMIN')).rejects.toThrow(
      'connection lost',
    );
  });
});
