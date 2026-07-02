import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  ForeignKey,
  ModelStatic,
} from 'sequelize';

export class Project extends Model<
  InferAttributes<Project>,
  InferCreationAttributes<Project>
> {
  declare id: CreationOptional<number>;
  declare projectName: string | null;
  declare projectId: string | null;
  declare projectAddress: string | null;
  declare typeOfProject: string | null;
  declare tenureInDays: number | null;
  declare companyId: ForeignKey<number> | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.Company as ModelStatic<Model>, {
      foreignKey: 'companyId',
      as: 'Company',
    });
    this.hasMany(models.ProjectPoc as ModelStatic<Model>, {
      foreignKey: 'projectId',
      as: 'ProjectPoc',
    });
    this.hasMany(models.Requisition as ModelStatic<Model>, {
      foreignKey: 'projectId',
      as: 'Requisition',
    });
  }
}

export default function projectModel(sequelize: Sequelize): typeof Project {
  Project.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      projectName: DataTypes.STRING,
      projectId: {
        type: DataTypes.STRING,
        unique: true,
      },
      projectAddress: DataTypes.STRING,
      typeOfProject: DataTypes.STRING,
      tenureInDays: DataTypes.INTEGER,
      companyId: DataTypes.INTEGER,
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'Projects',
      timestamps: true,
      underscored: false,
    }
  );

  Project.beforeCreate(async (project: Project) => {
    if (!project.projectId) {
      const lastProject = await Project.findOne({
        order: [['createdAt', 'DESC']],
      });

      let next = 1;
      if (lastProject?.projectId) {
        const parsed = parseInt(lastProject.projectId.replace('PRO', ''), 10);
        if (!Number.isNaN(parsed)) {
          next = parsed + 1;
        }
      }

      project.projectId = `PRO${String(next).padStart(4, '0')}`;
    }
  });

  return Project;
}
