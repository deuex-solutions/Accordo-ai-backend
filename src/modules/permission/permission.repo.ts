import models from '../../models/index.js';
import type { RolePermission } from '../../models/role-permission.js';

const repo = {
  getPermission: async (roleId: number | null): Promise<RolePermission | null> => {
    if (!roleId) {
      return null;
    }
    return models.RolePermission.findOne({ where: { roleId } });
  },
};

export default repo;
