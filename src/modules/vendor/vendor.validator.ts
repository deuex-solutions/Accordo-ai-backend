import Joi from "joi";

const options: Joi.ValidationOptions = {
  errors: {
    wrap: {
      label: "",
    },
  },
};

/**
 * Validates vendor creation data
 * @param userData - The vendor data to validate
 * @returns Joi validation result
 */
export const validateCreateVendor = (
  userData: unknown,
): Joi.ValidationResult => {
  const schema = Joi.object({
    email: Joi.string().email().required().messages({
      "string.email": "Email format is invalid",
      "any.required": "Email is required",
    }),
  }).unknown(true);

  return schema.validate(userData, options);
};

/**
 * Address schema for vendor company creation
 */
const addressSchema = Joi.object({
  label: Joi.string().max(100).required().messages({
    "any.required": "Address label is required",
  }),
  address: Joi.string().max(500).required().messages({
    "any.required": "Address is required",
  }),
  city: Joi.string().max(100).allow("", null),
  state: Joi.string().max(100).allow("", null),
  country: Joi.string().max(100).allow("", null),
  postalCode: Joi.string().max(20).allow("", null),
  isDefault: Joi.boolean().default(false),
});

/**
 * Validates vendor + company creation data
 * @param data - The combined vendor and company data to validate
 * @returns Joi validation result
 */
export const validateCreateVendorWithCompany = (
  data: unknown,
): Joi.ValidationResult => {
  const schema = Joi.object({
    // Vendor user info (required)
    name: Joi.string().max(255).required().messages({
      "any.required": "Vendor name is required",
    }),
    email: Joi.string().email().required().messages({
      "string.email": "Email format is invalid",
      "any.required": "Email is required",
    }),
    phone: Joi.string().max(20).allow("", null),

    // Company info (required)
    companyName: Joi.string().max(255).required().messages({
      "any.required": "Company name is required",
    }),
    establishmentDate: Joi.string().allow("", null),
    nature: Joi.string().valid("Domestic", "International").allow("", null),
    type: Joi.string().max(150).allow("", null),
    numberOfEmployees: Joi.string()
      .valid("0-10", "10-100", "100-1000", "1000+")
      .allow("", null),
    annualTurnover: Joi.string().allow("", null),
    industryType: Joi.string()
      .valid(
        "Construction",
        "Healthcare",
        "Transportation",
        "Information Technology",
        "Oil and Gas",
        "Defence",
        "Renewable Energy",
        "Telecommunication",
        "Agriculture",
        "Other",
      )
      .allow("", null),
    companyLogo: Joi.string().allow("", null),

    // Addresses (optional)
    addresses: Joi.array().items(addressSchema).allow(null),

    // Financial & Banking (optional)
    typeOfCurrency: Joi.string().valid("INR", "USD", "EUR").allow("", null),
    bankName: Joi.string().max(100).allow("", null),
    beneficiaryName: Joi.string().max(100).allow("", null),
    accountNumber: Joi.string().max(20).allow("", null),
    iBanNumber: Joi.string().max(34).allow("", null),
    swiftCode: Joi.string().max(11).allow("", null),
    bankAccountType: Joi.string().max(50).allow("", null),
    ifscCode: Joi.string().max(11).allow("", null),

    // Compliance documents (optional)
    gstNumber: Joi.string().max(100).allow("", null),
    panNumber: Joi.string().max(100).allow("", null),
    msmeNumber: Joi.string().max(100).allow("", null),
    ciNumber: Joi.string().max(100).allow("", null),

    // Point of contact (optional)
    pocName: Joi.string().max(100).allow("", null),
    pocDesignation: Joi.string().max(100).allow("", null),
    pocEmail: Joi.string().email().allow("", null),
    pocPhone: Joi.string().max(20).allow("", null),
    pocWebsite: Joi.string().allow("", null),

    // Escalation contact (optional)
    escalationName: Joi.string().max(100).allow("", null),
    escalationDesignation: Joi.string().max(100).allow("", null),
    escalationEmail: Joi.string().email().allow("", null),
    escalationPhone: Joi.string().max(20).allow("", null),
  });

  return schema.validate(data, options);
};

/**
 * Step 1: Validates vendor + company basic info
 * Creates vendor user and company with basic details
 */
export const validateStep1 = (data: unknown): Joi.ValidationResult => {
  const schema = Joi.object({
    // Vendor user info (required)
    name: Joi.string().max(255).required().messages({
      "any.required": "Vendor name is required",
    }),
    email: Joi.string().email().required().messages({
      "string.email": "Email format is invalid",
      "any.required": "Email is required",
    }),
    phone: Joi.string().max(20).allow("", null),

    // Company info (required)
    companyName: Joi.string().max(255).required().messages({
      "any.required": "Company name is required",
    }),
    establishmentDate: Joi.string().allow("", null),
    nature: Joi.string().valid("Domestic", "International").allow("", null),
    type: Joi.string().max(150).allow("", null),
    numberOfEmployees: Joi.string()
      .valid("0-10", "10-100", "100-1000", "1000+")
      .allow("", null),
    annualTurnover: Joi.string().allow("", null),
    industryType: Joi.string()
      .valid(
        "Construction",
        "Healthcare",
        "Transportation",
        "Information Technology",
        "Oil and Gas",
        "Defence",
        "Renewable Energy",
        "Telecommunication",
        "Agriculture",
        "Other",
      )
      .allow("", null),
    companyLogo: Joi.string().allow("", null),
  });

  return schema.validate(data, options);
};

/**
 * Step 2: Validates address/location data
 * All address fields are required for vendor company
 */
export const validateStep2 = (data: unknown): Joi.ValidationResult => {
  const schema = Joi.object({
    address: Joi.string().max(500).required().messages({
      "any.required": "Address is required",
      "string.empty": "Address is required",
    }),
    city: Joi.string().max(100).required().messages({
      "any.required": "City is required",
      "string.empty": "City is required",
    }),
    state: Joi.string().max(100).required().messages({
      "any.required": "State is required",
      "string.empty": "State is required",
    }),
    country: Joi.string().max(100).required().messages({
      "any.required": "Country is required",
      "string.empty": "Country is required",
    }),
    zipCode: Joi.string().max(20).required().messages({
      "any.required": "Zip code is required",
      "string.empty": "Zip code is required",
    }),
  });

  return schema.validate(data, options);
};

/**
 * Step 3: Validates financial and banking info
 */
export const validateStep3 = (data: unknown): Joi.ValidationResult => {
  const schema = Joi.object({
    // Currency
    typeOfCurrency: Joi.string()
      .valid("INR", "USD", "EUR", "GBP", "AUD")
      .allow("", null),

    // Banking
    bankName: Joi.string().max(100).allow("", null),
    beneficiaryName: Joi.string().max(100).allow("", null),
    accountNumber: Joi.string().max(20).allow("", null),
    iBanNumber: Joi.string().max(34).allow("", null),
    swiftCode: Joi.string().max(11).allow("", null),
    bankAccountType: Joi.string().max(50).allow("", null),
    ifscCode: Joi.string().max(11).allow("", null),
    fullAddress: Joi.string().max(500).allow("", null),

    // Compliance documents
    gstNumber: Joi.string().max(100).allow("", null),
    panNumber: Joi.string().max(100).allow("", null),
    msmeNumber: Joi.string().max(100).allow("", null),
    ciNumber: Joi.string().max(100).allow("", null),
  });

  return schema.validate(data, options);
};

/**
 * Step 4: Validates contact information
 */
export const validateStep4 = (data: unknown): Joi.ValidationResult => {
  const schema = Joi.object({
    // Point of contact
    pocName: Joi.string().max(100).allow("", null),
    pocDesignation: Joi.string().max(100).allow("", null),
    pocEmail: Joi.string().email().allow("", null).messages({
      "string.email": "POC email format is invalid",
    }),
    pocPhone: Joi.string().max(20).allow("", null),
    pocWebsite: Joi.string().max(500).allow("", null),

    // Escalation contact
    escalationName: Joi.string().max(100).allow("", null),
    escalationDesignation: Joi.string().max(100).allow("", null),
    escalationEmail: Joi.string().email().allow("", null).messages({
      "string.email": "Escalation email format is invalid",
    }),
    escalationPhone: Joi.string().max(20).allow("", null),
  });

  return schema.validate(data, options);
};

export default validateCreateVendor;
