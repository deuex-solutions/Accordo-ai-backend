import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { parseDatabaseUrl } from '../utils/parseDatabaseUrl.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

const dbUrlParsed = process.env.DATABASE_URL
  ? parseDatabaseUrl(process.env.DATABASE_URL)
  : null;

export interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  username: string;
  password: string;
  adminDatabase: string;
  ssl: boolean;
  sslRejectUnauthorized: boolean;
  logging: boolean;
}

export interface JWTConfig {
  accessSecret: string;
  refreshSecret: string;
  accessExpiry: string;
  refreshExpiry: string;
}

export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

export interface SMTPConfig {
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  from?: string;
}

export interface LLMConfig {
  baseURL: string;
  model: string;
  negotiationModel?: string;
  timeout: number;
}

export interface OpenAIConfig {
  apiKey?: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface VectorConfig {
  embeddingProvider: 'openai' | 'bedrock' | 'local';
  embeddingServiceUrl: string;
  embeddingModel: string;
  embeddingDimension: number;
  embeddingTimeout: number;
  defaultTopK: number;
  similarityThreshold: number;
  enableRealTimeVectorization: boolean;
  migrationBatchSize: number;
  awsRegion: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
}

export interface CORSConfig {
  origin: string | string[];
  credentials: boolean;
}

export interface EnvironmentConfig {
  nodeEnv: string;
  port: number;
  logLevel: string;
  database: DatabaseConfig;
  jwt: JWTConfig;
  rateLimit: RateLimitConfig;
  smtp: SMTPConfig;
  redisUrl?: string;
  llm: LLMConfig;
  openai: OpenAIConfig;
  vector: VectorConfig;
  cors: CORSConfig;
  vendorPortalUrl: string;
  chatbotFrontendUrl: string;
  chatbotApiUrl: string;
  backendUrl: string;
  /** When set, /api/auth/* is forwarded to this auth service (same paths and contracts). */
  authServiceUrl: string;
}

export const env: EnvironmentConfig = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 5002),
  logLevel: process.env.LOG_LEVEL || 'info',
  database: {
    host: process.env.DB_HOST || dbUrlParsed?.host || '127.0.0.1',
    port: Number(process.env.DB_PORT || dbUrlParsed?.port || 5432),
    name: process.env.DB_NAME || dbUrlParsed?.name || 'accordo',
    username: process.env.DB_USERNAME || dbUrlParsed?.username || 'postgres',
    password: process.env.DB_PASSWORD || dbUrlParsed?.password || 'postgres',
    adminDatabase: process.env.DB_ADMIN_DATABASE || dbUrlParsed?.name || process.env.DB_NAME || 'postgres',
    ssl: process.env.DB_SSL === 'true' || !!dbUrlParsed,
    sslRejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    logging: process.env.DB_LOGGING === 'true',
  },
  jwt: {
    accessSecret:
      process.env.JWT_ACCESS_TOKEN_SECRET || process.env.JWT_SECRET || 'change-me',
    refreshSecret:
      process.env.JWT_REFRESH_TOKEN_SECRET || process.env.JWT_SECRET || 'change-me',
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '1h',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },
  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW || 15 * 60 * 1000),
    max: Number(process.env.RATE_LIMIT_MAX || 100),
  },
  smtp: {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM_EMAIL,
  },
  redisUrl: process.env.REDIS_URL,
  llm: {
    baseURL: process.env.LLM_BASE_URL || 'http://localhost:11434',
    model: process.env.LLM_MODEL || 'qwen3',
    negotiationModel: process.env.LLM_NEGOTIATION_MODEL,
    timeout: Number(process.env.LLM_TIMEOUT || 60000),
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
    maxTokens: Number(process.env.OPENAI_MAX_TOKENS || 1000),
    temperature: Number(process.env.OPENAI_TEMPERATURE || 0.7),
  },
  vector: {
    embeddingProvider: (process.env.EMBEDDING_PROVIDER || 'local') as 'openai' | 'bedrock' | 'local',
    embeddingServiceUrl: process.env.EMBEDDING_SERVICE_URL || 'http://localhost:5003',
    embeddingModel: process.env.EMBEDDING_MODEL || '',
    embeddingDimension: Number(process.env.EMBEDDING_DIMENSION || 1024),
    embeddingTimeout: Number(process.env.EMBEDDING_TIMEOUT || 30000),
    defaultTopK: Number(process.env.VECTOR_DEFAULT_TOP_K || 5),
    similarityThreshold: Number(process.env.VECTOR_SIMILARITY_THRESHOLD || 0.7),
    enableRealTimeVectorization: process.env.ENABLE_REALTIME_VECTORIZATION !== 'false',
    migrationBatchSize: Number(process.env.VECTOR_MIGRATION_BATCH_SIZE || 100),
    awsRegion: process.env.AWS_REGION || 'us-east-1',
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  cors: {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim())
      : '*',
    credentials: process.env.CORS_ORIGIN ? true : false,
  },
  vendorPortalUrl: process.env.VENDOR_PORTAL_URL || 'http://localhost:5001/vendor',
  chatbotFrontendUrl: process.env.CHATBOT_FRONTEND_URL || 'http://localhost:5001',
  chatbotApiUrl: process.env.CHATBOT_API_URL || 'http://localhost:5002/api',
  backendUrl: process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5002}`,
  authServiceUrl: process.env.AUTH_SERVICE_URL?.replace(/\/$/, '') || 'http://localhost:5003',
};

export default env;
