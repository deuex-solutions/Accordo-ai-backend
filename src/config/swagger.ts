import swaggerJsdoc from 'swagger-jsdoc';
import env from './env.js';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Accordo AI Backend API',
      version: '1.0.0',
      description: `
## Accordo AI - B2B Procurement Negotiation Platform

This API provides endpoints for:
- **Authentication** - User registration, login, and JWT token management
- **Negotiation Chatbot** - AI-powered utility-based negotiation engine
- **Bid Comparison** - Multi-vendor bid tracking, PDF reports, and vendor selection
- **Vector Search** - RAG-enhanced semantic search for negotiations
- **Requisitions & Contracts** - Purchase requisition and contract management
- **Company & Vendor Management** - Company and vendor entity operations

### Service Health Monitoring
Use the \`/api/health/services\` endpoint to check the status of all backend services including:
- Database (PostgreSQL)
- LLM Service (Ollama)
- Embedding Service (Python FastAPI)
- Redis (if configured)
      `,
      contact: {
        name: 'Accordo AI Support',
        email: 'support@accordo.ai',
      },
    },
    servers: [
      {
        url: `http://localhost:${env.port}`,
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter JWT token obtained from /api/auth/login',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Error message' },
            error: { type: 'string', example: 'Detailed error' },
          },
        },
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Operation successful' },
            data: { type: 'object' },
          },
        },
        ServiceHealth: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'database' },
            status: { type: 'string', enum: ['healthy', 'unhealthy', 'degraded'], example: 'healthy' },
            latency: { type: 'number', example: 5.2 },
            message: { type: 'string', example: 'Connected to PostgreSQL' },
          },
        },
        HealthResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['healthy', 'unhealthy', 'degraded'] },
            timestamp: { type: 'string', format: 'date-time' },
            version: { type: 'string', example: '1.0.0' },
            uptime: { type: 'number', example: 3600 },
            services: {
              type: 'array',
              items: { $ref: '#/components/schemas/ServiceHealth' },
            },
          },
        },
        Deal: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string', example: 'Office Supplies Negotiation' },
            status: { type: 'string', enum: ['NEGOTIATING', 'ACCEPTED', 'WALKED_AWAY', 'ESCALATED'] },
            mode: { type: 'string', enum: ['CONVERSATION'] },
            currentRound: { type: 'integer', example: 3 },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Message: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            dealId: { type: 'string', format: 'uuid' },
            role: { type: 'string', enum: ['VENDOR', 'ACCORDO', 'SYSTEM'] },
            content: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        VendorBid: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            requisitionId: { type: 'integer' },
            vendorId: { type: 'integer' },
            finalPrice: { type: 'number', example: 95000 },
            unitPrice: { type: 'number', example: 95 },
            paymentTerms: { type: 'string', example: 'Net 30' },
            bidStatus: { type: 'string', enum: ['PENDING', 'COMPLETED', 'EXCLUDED', 'SELECTED', 'REJECTED'] },
            utilityScore: { type: 'number', example: 0.85 },
          },
        },
        BidComparison: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            requisitionId: { type: 'integer' },
            triggeredBy: { type: 'string', enum: ['ALL_COMPLETED', 'DEADLINE_REACHED', 'MANUAL'] },
            totalVendors: { type: 'integer', example: 5 },
            completedVendors: { type: 'integer', example: 4 },
            pdfUrl: { type: 'string' },
            emailStatus: { type: 'string', enum: ['PENDING', 'SENT', 'FAILED'] },
          },
        },
        KpiMetric: {
          type: 'object',
          properties: {
            value: { type: 'number', example: 127500 },
            delta: { type: 'number', example: 18.2 },
            trend: { type: 'string', enum: ['up', 'down', 'neutral'], example: 'up' },
          },
        },
        DashboardKpis: {
          type: 'object',
          properties: {
            totalSavings: { $ref: '#/components/schemas/KpiMetric' },
            activeNegotiations: { $ref: '#/components/schemas/KpiMetric' },
            totalRequisitions: { $ref: '#/components/schemas/KpiMetric' },
            avgDealImprovement: { $ref: '#/components/schemas/KpiMetric' },
          },
        },
        NegotiationPipeline: {
          type: 'object',
          properties: {
            negotiating: { type: 'integer', example: 8 },
            accepted: { type: 'integer', example: 15 },
            walkedAway: { type: 'integer', example: 3 },
            escalated: { type: 'integer', example: 2 },
          },
        },
        SavingsTimeline: {
          type: 'object',
          properties: {
            labels: { type: 'array', items: { type: 'string' }, example: ['Jan 1', 'Jan 2', 'Jan 3'] },
            data: { type: 'array', items: { type: 'number' }, example: [12000, 18500, 9200] },
            cumulative: { type: 'array', items: { type: 'number' }, example: [12000, 30500, 39700] },
            previousPeriodCumulative: { type: 'array', items: { type: 'number' }, example: [10000, 25000, 32000] },
            summary: {
              type: 'object',
              properties: {
                total: { type: 'number', example: 39700 },
                avgPerBucket: { type: 'number', example: 13233 },
                peakValue: { type: 'number', example: 18500 },
                peakLabel: { type: 'string', example: 'Jan 2' },
              },
            },
          },
        },
        SpendCategory: {
          type: 'object',
          properties: {
            category: { type: 'string', example: 'IT/Electronics' },
            amount: { type: 'number', example: 250000 },
            percentage: { type: 'number', example: 42 },
          },
        },
        ActivityItem: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string', enum: ['deal_accepted', 'deal_walked_away', 'deal_escalated', 'deal_started', 'requisition_created', 'contract_sent'] },
            title: { type: 'string', example: 'Office Supplies Deal' },
            description: { type: 'string', example: 'Vendor ABC — accepted' },
            timestamp: { type: 'string', format: 'date-time' },
            entityType: { type: 'string', enum: ['deal', 'requisition', 'contract'] },
            rfqId: { type: 'integer' },
            vendorId: { type: 'integer' },
            dealId: { type: 'string' },
          },
        },
        NeedsAttention: {
          type: 'object',
          properties: {
            stalledNegotiations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  dealId: { type: 'string' },
                  rfqId: { type: 'integer' },
                  vendorId: { type: 'integer' },
                  title: { type: 'string' },
                  vendorName: { type: 'string' },
                  lastActivityAt: { type: 'string', format: 'date-time' },
                  daysSinceActivity: { type: 'integer', example: 5 },
                },
              },
            },
            approachingDeadlines: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  dealId: { type: 'string' },
                  rfqId: { type: 'integer' },
                  vendorId: { type: 'integer' },
                  title: { type: 'string' },
                  deadline: { type: 'string', format: 'date-time' },
                  daysRemaining: { type: 'integer', example: 2 },
                },
              },
            },
            escalatedDeals: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  dealId: { type: 'string' },
                  rfqId: { type: 'integer' },
                  vendorId: { type: 'integer' },
                  title: { type: 'string' },
                  vendorName: { type: 'string' },
                  escalatedAt: { type: 'string', format: 'date-time' },
                  reason: { type: 'string' },
                },
              },
            },
            unresponsiveVendors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  vendorId: { type: 'integer' },
                  vendorName: { type: 'string' },
                  dealId: { type: 'string' },
                  rfqId: { type: 'integer' },
                  lastNotifiedAt: { type: 'string', format: 'date-time' },
                  daysSinceNotification: { type: 'integer', example: 4 },
                },
              },
            },
          },
        },
        DashboardStatsData: {
          type: 'object',
          properties: {
            kpis: { $ref: '#/components/schemas/DashboardKpis' },
            negotiationPipeline: { $ref: '#/components/schemas/NegotiationPipeline' },
            savingsOverTime: { $ref: '#/components/schemas/SavingsTimeline' },
            spendByCategory: { type: 'array', items: { $ref: '#/components/schemas/SpendCategory' } },
            recentActivity: { type: 'array', items: { $ref: '#/components/schemas/ActivityItem' } },
            needsAttention: { $ref: '#/components/schemas/NeedsAttention' },
          },
        },
      },
    },
    tags: [
      { name: 'Health', description: 'Service health monitoring endpoints' },
      { name: 'Auth', description: 'Authentication and authorization' },
      { name: 'Chatbot', description: 'Negotiation chatbot and deal management' },
      { name: 'Bid Comparison', description: 'Vendor bid comparison and selection' },
      { name: 'Vector', description: 'Vector search and RAG operations' },
      { name: 'Requisition', description: 'Purchase requisition management' },
      { name: 'Contract', description: 'Contract management' },
      { name: 'Vendor', description: 'Vendor operations' },
      { name: 'Company', description: 'Company management' },
      { name: 'User', description: 'User management' },
      { name: 'Product', description: 'Product catalog' },
      { name: 'Dashboard', description: 'Dashboard analytics' },
    ],
  },
  apis: [
    './src/routes/*.ts',
    './src/modules/health/*.ts',
    './src/modules/swagger.docs.ts',
  ],
};

export const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
