import { Test } from '@nestjs/testing';
import { describe, it, expect, vi } from 'vitest';
import { UsersService } from './users.service.js';
import { DB, PrismaModule } from '../prisma/prisma.module.js';

describe('UsersService', () => {
  it('should use the overridden DB provider for DI', async () => {
    const fakeUser = { id: 1, email: 'test@example.com', name: 'Test' };
    const fakePost = { id: 1, title: 'Welcome, Test!', authorId: 1 };

    const fakeDb = {
      orm: {
        public: {
          User: {
            where: vi.fn().mockReturnValue({
              include: vi.fn().mockReturnValue({
                first: vi.fn().mockResolvedValue(fakeUser),
              }),
            }),
            create: vi.fn().mockResolvedValue(fakeUser),
          },
          Post: {
            create: vi.fn().mockResolvedValue(fakePost),
          },
        },
      },
      transaction: vi.fn().mockImplementation(async (fn) => {
        const tx = {
          orm: {
            public: {
              User: { create: fakeDb.orm.public.User.create },
              Post: { create: fakeDb.orm.public.Post.create },
            },
          },
        };
        return fn(tx);
      }),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [UsersService],
    })
      .overrideProvider(DB)
      .useValue(fakeDb)
      .compile();

    const service = moduleRef.get(UsersService);

    // Test findOne
    const result1 = await service.findOne(1);
    expect(result1).toEqual(fakeUser);
    expect(fakeDb.orm.public.User.where).toHaveBeenCalledWith({ id: 1 });

    // Test createWithWelcomePost
    const result2 = await service.createWithWelcomePost({ email: 'test@example.com', name: 'Test' });
    expect(result2).toEqual({ user: fakeUser, post: fakePost });
    expect(fakeDb.transaction).toHaveBeenCalled();
  });
});
