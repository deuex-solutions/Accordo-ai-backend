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

export class RequisitionAttachment extends Model<
  InferAttributes<RequisitionAttachment>,
  InferCreationAttributes<RequisitionAttachment>
> {
  declare id: CreationOptional<number>;
  declare requisitionId: ForeignKey<number> | null;
  declare attachmentUrl: string | null;
  declare createdBy: ForeignKey<number> | null;
  declare createdAt: CreationOptional<Date>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.Requisition as ModelStatic<Model>, {
      foreignKey: 'requisitionId',
      as: 'Requisition',
    });
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'createdBy',
      as: 'Creator',
    });
  }
}

export default function requisitionAttachmentModel(sequelize: Sequelize): typeof RequisitionAttachment {
  RequisitionAttachment.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      requisitionId: DataTypes.INTEGER,
      attachmentUrl: DataTypes.STRING,
      createdBy: DataTypes.INTEGER,
      createdAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'RequisitionAttachments',
      timestamps: true,
      underscored: false,
      updatedAt: false,
    }
  );

  return RequisitionAttachment;
}
