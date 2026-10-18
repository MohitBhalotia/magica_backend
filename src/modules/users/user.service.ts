import type { DbClient } from "@/lib/db";
import { userRepository } from "@/modules/users/user.repository";

export const userService = {
  ensure: (userId: string, tx?: DbClient) => userRepository.ensure(userId, tx),
};
