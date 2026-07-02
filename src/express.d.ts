import { User } from './models/auth/user.js';

declare global {
  namespace Express {
    interface Request {
      context: {
        userId: number;
        userType: string;
        companyId?: number;
        email?: string;
      };
      user?: User;
      files?: Express.Multer.File[];
    }
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    context: {
      userId: number;
      userType: string;
      companyId?: number;
      email?: string;
    };
    user?: User;
    files?: Express.Multer.File[];
  }
}

export {};
