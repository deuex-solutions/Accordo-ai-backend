import { Op } from 'sequelize';
import repo from './customer.repo.js';
import userRepo from '../user/user.repo.js';
import { CustomError } from '../../utils/custom-error.js';
import type { User } from '../../models/auth/user.js';

export interface PaginatedCustomersResponse {
  data: User[];
  total: number;
  page: number;
  totalPages: number;
}

export const getCustomersService = async (userId: number): Promise<User[]> => {
  try {
    const user = await userRepo.getUserProfile(userId);
    if (!user?.companyId) {
      throw new CustomError('User company not found', 400);
    }
    return repo.getCustomers(user.companyId);
  } catch (error) {
    throw new CustomError((error as Error).message || String(error), 400);
  }
};

export const getAllCustomerService = async (
  search: string | undefined,
  page: number | string = 1,
  limit: number | string = 10
): Promise<PaginatedCustomersResponse> => {
  try {
    const parsedPage = Number.parseInt(String(page), 10) || 1;
    const parsedLimit = Number.parseInt(String(limit), 10) || 10;
    const offset = (parsedPage - 1) * parsedLimit;

    const queryOptions: any = {
      limit: parsedLimit,
      offset,
      where: {},
    };

    if (search) {
      queryOptions.where.name = {
        [Op.like]: `%${search}%`,
      };
    }

    const { rows, count } = await repo.getAllCustomers(queryOptions);
    return {
      data: rows,
      total: count,
      page: parsedPage,
      totalPages: parsedLimit ? Math.ceil(count / parsedLimit) : 1,
    };
  } catch (error) {
    throw new CustomError(`Service ${error}`, 400);
  }
};
