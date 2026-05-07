import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';

export type MigrationStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type MigrationType = 'messages' | 'deals' | 'patterns' | 'full';

export class VectorMigrationStatus extends Model<
  InferAttributes<VectorMigrationStatus>,
  InferCreationAttributes<VectorMigrationStatus>
> {
  declare id: CreationOptional<number>;
  declare migrationType: MigrationType;
  declare status: MigrationStatus;
  declare totalRecords: number;
  declare processedRecords: number;
  declare failedRecords: number;
  declare currentBatch: number;
  declare totalBatches: number;
  declare batchSize: number;
  declare lastProcessedId: string | null;
  declare errorMessage: string | null;
  declare errorDetails: object | null;
  declare startedAt: Date | null;
  declare completedAt: Date | null;
  declare estimatedTimeRemaining: number | null;
  declare processingRate: number | null;
  declare metadata: object | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initVectorMigrationStatusModel(sequelize: Sequelize): typeof VectorMigrationStatus {
  VectorMigrationStatus.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      migrationType: {
        type: DataTypes.ENUM('messages', 'deals', 'patterns', 'full'),
        allowNull: false,
        field: 'migration_type',
      },
      status: {
        type: DataTypes.ENUM('pending', 'in_progress', 'completed', 'failed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      totalRecords: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'total_records',
      },
      processedRecords: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'processed_records',
      },
      failedRecords: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'failed_records',
      },
      currentBatch: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'current_batch',
      },
      totalBatches: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'total_batches',
      },
      batchSize: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 100,
        field: 'batch_size',
      },
      lastProcessedId: {
        type: DataTypes.STRING,
        allowNull: true,
        field: 'last_processed_id',
      },
      errorMessage: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'error_message',
      },
      errorDetails: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'error_details',
      },
      startedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'started_at',
      },
      completedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'completed_at',
      },
      estimatedTimeRemaining: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'estimated_time_remaining',
        comment: 'Estimated seconds remaining',
      },
      processingRate: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        field: 'processing_rate',
        comment: 'Records processed per second',
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Additional metadata about the migration',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at',
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at',
      },
    },
    {
      sequelize,
      tableName: 'vector_migration_status',
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: 'idx_vector_migration_type',
          fields: ['migration_type'],
        },
        {
          name: 'idx_vector_migration_status',
          fields: ['status'],
        },
        {
          name: 'idx_vector_migration_created_at',
          fields: ['created_at'],
        },
      ],
    }
  );
  return VectorMigrationStatus;
}
