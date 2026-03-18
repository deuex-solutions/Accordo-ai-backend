import Joi from "joi";

/**
 * Joi validation options
 */
const options: Joi.ValidationOptions = {
  errors: {
    wrap: {
      label: "",
    },
  },
};

/**
 * User sign up data interface
 */
export interface SignUpData {
  email: string;
  name: string;
  username?: string;
  companyId?: number;
  password: string;
  roleId?: number;
}

/**
 * User sign in data interface
 */
export interface SignInData {
  email: string;
  password: string;
}

/**
 * Forgot password data interface
 */
export interface ForgotPasswordData {
  email: string;
}

/**
 * User ID validation data interface
 */
export interface UserIdData {
  user_id: number;
  password: string;
}

/**
 * OTP validation data interface
 */
export interface OtpData {
  email: string;
  otp: number;
}

/**
 * Refresh token data interface
 */
export interface RefreshTokenData {
  refreshToken: string;
}

/**
 * Validate sign up data
 * @param userData - Sign up data to validate
 * @returns Joi validation result
 */
export const validateSignUp = (userData: SignUpData): Joi.ValidationResult => {
  const schema = Joi.object({
    email: Joi.string().email().required().messages({
      "string.email": "Email format is invalid",
      "any.required": "Email is required",
    }),
    name: Joi.string().min(1).required().messages({
      "string.min": "Name should at least minimum 1 character",
      "any.required": "Name is required",
    }),
    username: Joi.string().optional(),
    companyId: Joi.number().integer().optional(),
    password: Joi.string()
      .min(8)
      .pattern(new RegExp("^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^a-zA-Z\\d]).+$"))
      .required()
      .messages({
        "string.min": "Password must have at least 8 characters.",
        "string.pattern.base":
          "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character.",
        "any.required": "Password is required.",
      }),
  });

  return schema.validate(userData, options);
};

/**
 * Validate sign in data
 * @param userData - Sign in data to validate
 * @returns Joi validation result
 */
export const validateSignIn = (userData: SignInData): Joi.ValidationResult => {
  const schema = Joi.object({
    email: Joi.string().email().required().messages({
      "string.email": "Email format is invalid",
      "any.required": "Email is required",
    }),
    password: Joi.string().required(),
  });
  return schema.validate(userData, options);
};

/**
 * Validate forgot password data
 * @param userData - Forgot password data to validate
 * @returns Joi validation result
 */
export const validateForgotPassword = (userData: ForgotPasswordData): Joi.ValidationResult => {
  const schema = Joi.object({
    email: Joi.string().email().required().messages({
      "string.email": "Email format is invalid",
      "any.required": "Email is required",
    }),
  });

  return schema.validate(userData, options);
};

/**
 * Validate user ID data
 * @param userData - User ID data to validate
 * @returns Joi validation result
 */
export const validateUserId = (userData: UserIdData): Joi.ValidationResult => {
  const schema = Joi.object({
    user_id: Joi.number().integer().required(),
    password: Joi.string()
      .required()
      .messages({ "any.required": "New password is required" }),
  });

  return schema.validate(userData, options);
};

/**
 * Validate OTP data
 * @param userData - OTP data to validate
 * @returns Joi validation result
 */
export const validateOtpData = (userData: OtpData): Joi.ValidationResult => {
  const schema = Joi.object({
    email: Joi.string().email().required().messages({
      "string.email": "Email format is invalid",
      "any.required": "Email is required",
    }),
    otp: Joi.number()
      .integer()
      .required()
      .messages({ "any.required": "Otp is required" }),
  });

  return schema.validate(userData, options);
};

/**
 * Validate refresh token data
 * @param data - Refresh token data to validate
 * @returns Joi validation result
 */
export const validateRefreshToken = (data: RefreshTokenData): Joi.ValidationResult => {
  const schema = Joi.object({
    refreshToken: Joi.string().required().messages({
      "any.required": "Refresh token is required",
    }),
  });

  return schema.validate(data, options);
};
