import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  ForeignKey,
  ModelStatic,
  NonAttribute,
} from 'sequelize';

const selectionMethodEnum = ['EMAIL_LINK', 'PORTAL', 'API'] as const;

export type SelectionMethod = (typeof selectionMethodEnum)[number];

export class VendorSelection extends Model<
  InferAttributes<VendorSelection>,
  InferCreationAttributes<VendorSelection>
> {
  declare id: CreationOptional<string>;
  declare requisitionId: ForeignKey<number>;
  declare comparisonId: ForeignKey<string> | null;

  // Selection
  declare selectedVendorId: ForeignKey<number>;
  declare selectedBidId: ForeignKey<string>;
  declare selectedPrice: number;

  // Audit
  declare selectedByUserId: ForeignKey<number>;
  declare selectionReason: string | null;
  declare selectionMethod: SelectionMethod;

  // Generated artifacts
  declare poId: ForeignKey<number> | null;

  // Timestamps
  declare selectedAt: Date;
  declare createdAt: CreationOptional<Date>;

  // Associations
  declare Requisition?: NonAttribute<any>;
  declare Comparison?: NonAttribute<any>;
  declare SelectedVendor?: NonAttribute<any>;
  declare SelectedBid?: NonAttribute<any>;
  declare SelectedBy?: NonAttribute<any>;
  declare PurchaseOrder?: NonAttribute<any>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.Requisition as ModelStatic<Model>, {
      foreignKey: 'requisitionId',
      as: 'Requisition',
    });
    this.belongsTo(models.BidComparison as ModelStatic<Model>, {
      foreignKey: 'comparisonId',
      as: 'Comparison',
    });
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'selectedVendorId',
      as: 'SelectedVendor',
    });
    this.belongsTo(models.VendorBid as ModelStatic<Model>, {
      foreignKey: 'selectedBidId',
      as: 'SelectedBid',
    });
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'selectedByUserId',
      as: 'SelectedBy',
    });
    this.belongsTo(models.Po as ModelStatic<Model>, {
      foreignKey: 'poId',
      as: 'PurchaseOrder',
    });
  }
}

export default function vendorSelectionModel(sequelize: Sequelize): typeof VendorSelection {
  VendorSelection.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      requisitionId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'Requisitions',
          key: 'id',
        },
      },
      comparisonId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'bid_comparisons',
          key: 'id',
        },
        comment: 'Reference to the comparison report that led to this selection',
      },
      selectedVendorId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'User',
          key: 'id',
        },
        comment: 'The vendor who was selected',
      },
      selectedBidId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'vendor_bids',
          key: 'id',
        },
        comment: 'The specific bid that was selected',
      },
      selectedPrice: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        comment: 'The final price of the selected bid',
      },
      selectedByUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'User',
          key: 'id',
        },
        comment: 'User who made the selection decision',
      },
      selectionReason: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Optional reason provided for the selection',
      },
      selectionMethod: {
        type: DataTypes.ENUM(...selectionMethodEnum),
        allowNull: false,
      },
      poId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'Pos',
          key: 'id',
        },
        comment: 'Auto-generated Purchase Order ID',
      },
      selectedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment: 'When the selection was made',
      },
      createdAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'vendor_selections',
      timestamps: true,
      underscored: true,
      updatedAt: false,
      indexes: [
        { fields: ['requisition_id'] },
        { fields: ['selected_vendor_id'] },
        { fields: ['selected_by_user_id'] },
        { fields: ['selected_at'] },
        {
          fields: ['requisition_id'],
          unique: true,
          name: 'unique_requisition_selection',
          where: { po_id: { [Symbol.for('ne')]: null } },
        },
      ],
    }
  );

  return VendorSelection;
}
