import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  ModelStatic,
} from 'sequelize';

const natureEnum = ['Domestic', 'Interational', 'International'] as const;
const employeesEnum = ['0-10', '10-100', '100-1000', '1000+'] as const;
const industryEnum = [
  'Construction',
  'Healthcare',
  'Transportation',
  'Information Technology',
  'Oil and Gas',
  'Defence',
  'Renewable Energy',
  'Telecommunication',
  'Agriculture',
  'Other',
] as const;
const currencyEnum = ['INR', 'USD', 'EUR'] as const;

export type CompanyNature = (typeof natureEnum)[number];
export type EmployeesRange = (typeof employeesEnum)[number];
export type IndustryType = (typeof industryEnum)[number];
export type CurrencyType = (typeof currencyEnum)[number];

export class Company extends Model<
  InferAttributes<Company>,
  InferCreationAttributes<Company>
> {
  declare id: CreationOptional<number>;
  declare companyName: string | null;
  declare companyLogo: string | null;
  declare apiKey: string | null;
  declare apiSecret: string | null;
  declare establishmentDate: Date | null;
  declare nature: CompanyNature | null;
  declare type: string | null;
  declare numberOfEmployees: EmployeesRange | null;
  declare annualTurnover: string | null;
  declare industryType: IndustryType | null;
  declare customIndustryType: string | null;
  declare gstNumber: string | null;
  declare gstFileUrl: string | null;
  declare panNumber: string | null;
  declare panFileUrl: string | null;
  declare msmeNumber: string | null;
  declare msmeFileUrl: string | null;
  declare ciNumber: string | null;
  declare ciFileUrl: string | null;
  declare pocName: string | null;
  declare pocDesignation: string | null;
  declare pocEmail: string | null;
  declare pocPhone: string | null;
  declare pocWebsite: string | null;
  declare escalationName: string | null;
  declare escalationDesignation: string | null;
  declare escalationEmail: string | null;
  declare escalationPhone: string | null;
  declare typeOfCurrency: CurrencyType | null;
  declare bankName: string | null;
  declare beneficiaryName: string | null;
  declare accountNumber: string | null;
  declare iBanNumber: string | null;
  declare swiftCode: string | null;
  declare bankAccountType: string | null;
  declare cancelledCheque: string | null;
  declare cancelledChequeURL: string | null;
  declare ifscCode: string | null;
  declare taxInPercentage: number | null;
  declare fullAddress: string | null;
  declare createdBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // Association fields populated via include
  declare Addresses?: {
    id: number;
    label: string;
    address: string;
    city: string | null;
    state: string | null;
    country: string | null;
    postalCode: string | null;
    isDefault: boolean;
  }[];

  static associate(models: Record<string, typeof Model>): void {
    this.hasMany(models.User as ModelStatic<Model>, { foreignKey: 'companyId', as: 'Users' });
    this.hasMany(models.User as ModelStatic<Model>, { foreignKey: 'companyId', as: 'Vendor' });
    this.hasMany(models.Po as ModelStatic<Model>, { foreignKey: 'companyId', as: 'Po' });
    this.hasMany(models.Project as ModelStatic<Model>, { foreignKey: 'companyId', as: 'Project' });
    this.hasMany(models.VendorCompany as ModelStatic<Model>, {
      foreignKey: 'companyId',
      as: 'VendorCompanies',
    });
    this.hasMany(models.VendorCompany as ModelStatic<Model>, {
      foreignKey: 'companyId',
      as: 'vendorCompany',
    });
    this.hasMany(models.Address as ModelStatic<Model>, {
      foreignKey: 'companyId',
      as: 'Addresses',
    });
  }
}

export default function companyModel(sequelize: Sequelize): typeof Company {
  Company.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      companyName: DataTypes.STRING,
      companyLogo: DataTypes.STRING,
      apiKey: DataTypes.TEXT,
      apiSecret: DataTypes.STRING(150),
      establishmentDate: DataTypes.DATE,
      nature: DataTypes.ENUM(...natureEnum),
      type: DataTypes.STRING(150),
      numberOfEmployees: DataTypes.ENUM(...employeesEnum),
      annualTurnover: DataTypes.STRING,
      industryType: DataTypes.ENUM(...industryEnum),
      customIndustryType: DataTypes.STRING(100),
      gstNumber: DataTypes.STRING(100),
      gstFileUrl: DataTypes.STRING,
      panNumber: DataTypes.STRING(100),
      panFileUrl: DataTypes.STRING,
      msmeNumber: DataTypes.STRING(100),
      msmeFileUrl: DataTypes.STRING,
      ciNumber: DataTypes.STRING(100),
      ciFileUrl: DataTypes.STRING,
      pocName: DataTypes.STRING(100),
      pocDesignation: DataTypes.STRING(100),
      pocEmail: DataTypes.STRING(100),
      pocPhone: DataTypes.STRING(20),
      pocWebsite: DataTypes.STRING,
      escalationName: DataTypes.STRING(100),
      escalationDesignation: DataTypes.STRING(100),
      escalationEmail: DataTypes.STRING(100),
      escalationPhone: DataTypes.STRING(20),
      typeOfCurrency: DataTypes.ENUM(...currencyEnum),
      bankName: DataTypes.STRING(100),
      beneficiaryName: DataTypes.STRING(100),
      accountNumber: DataTypes.STRING(20),
      iBanNumber: DataTypes.STRING(34),
      swiftCode: DataTypes.STRING(11),
      bankAccountType: DataTypes.STRING(50),
      cancelledCheque: DataTypes.STRING,
      cancelledChequeURL: DataTypes.STRING,
      ifscCode: DataTypes.STRING(11),
      taxInPercentage: DataTypes.DOUBLE,
      fullAddress: DataTypes.STRING,
      createdBy: DataTypes.INTEGER,
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'Companies',
      timestamps: true,
      underscored: false,
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    }
  );

  return Company;
}
