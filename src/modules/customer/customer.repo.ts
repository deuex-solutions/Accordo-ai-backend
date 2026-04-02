import models from '../../models/index.js';
import type { User } from '../../models/user.js';
import type { WhereOptions, FindOptions } from 'sequelize';

export interface CustomerQueryOptions {
  limit?: number;
  offset?: number;
  where?: WhereOptions<User>;
}

export interface FindAndCountResult {
  rows: User[];
  count: number;
}

const repo = {
  getCustomers: async (companyId: number): Promise<User[]> => {
    return models.User.findAll({
      where: { companyId, userType: 'procurement' },
    });
  },

  getAllCustomers: async (
    queryOptions: CustomerQueryOptions = {}
  ): Promise<FindAndCountResult> => {
    const options: FindOptions<User> = {
      ...queryOptions,
      where: {
        ...(queryOptions.where || {}),
        userType: 'procurement',
      },
    };

    return models.User.findAndCountAll(options);
  },
};

export default repo;
