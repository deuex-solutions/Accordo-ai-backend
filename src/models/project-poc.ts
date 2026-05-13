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

export class ProjectPoc extends Model<
  InferAttributes<ProjectPoc>,
  InferCreationAttributes<ProjectPoc>
> {
  declare id: CreationOptional<number>;
  declare projectId: ForeignKey<number> | null;
  declare userId: ForeignKey<number> | null;
  declare createdBy: ForeignKey<number> | null;
  declare createdAt: CreationOptional<Date>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.Project as ModelStatic<Model>, {
      foreignKey: 'projectId',
      as: 'Project',
    });
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'userId',
      as: 'User',
    });
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'createdBy',
      as: 'Creator',
    });
  }
}

export default function projectPocModel(sequelize: Sequelize): typeof ProjectPoc {
  ProjectPoc.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      projectId: DataTypes.INTEGER,
      userId: DataTypes.INTEGER,
      createdBy: DataTypes.INTEGER,
      createdAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'ProjectPocs',
      timestamps: true,
      underscored: false,
      updatedAt: false,
    }
  );

  return ProjectPoc;
}
